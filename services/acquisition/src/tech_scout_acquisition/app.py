import asyncio
import hmac
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import settings
from .models import Operation, Plan
from .store import Store
from .worker import Worker


@asynccontextmanager
async def lifespan(app):
    config = settings()
    async with AsyncConnectionPool(
        config.acquisition_database_url.get_secret_value(),
        open=False,
        kwargs={"autocommit": True, "row_factory": dict_row},
    ) as pool:
        await pool.wait()
        app.state.store = Store(pool)
        app.state.worker = Worker(app.state.store, config)
        task = asyncio.create_task(app.state.worker.sweep())
        app.state.sweeper = task
        app.state.action_lock = asyncio.Lock()
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


async def authenticate(authorization: str = Header(default="")):
    token = "Bearer " + settings().acquisition_internal_token.get_secret_value()
    if not hmac.compare_digest(authorization.encode(), token.encode()):
        raise HTTPException(401, "内部认证失败")


app = FastAPI(
    title="TechScout Acquisition",
    lifespan=lifespan,
    dependencies=[Depends(authenticate)],
)


@app.get("/health")
async def health(request: Request):
    if request.app.state.sweeper.done():
        raise HTTPException(503, "采集调度器已停止，请检查服务日志")
    async with request.app.state.store.pool.connection() as conn:
        await conn.execute("SELECT 1 FROM ingestion.job LIMIT 1")
    return {"status": "ok"}


@app.post("/jobs/{run_id}")
async def start(run_id: UUID, plan: Plan, request: Request):
    try:
        return await request.app.state.store.create(run_id, plan.model_dump())
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@app.get("/jobs/{run_id}")
async def get(run_id: UUID, request: Request):
    job = await request.app.state.store.get(run_id)
    if not job:
        raise HTTPException(404, "采集任务不存在")
    return job


@app.post("/jobs/{run_id}/actions")
async def action(run_id: UUID, operation: Operation, request: Request):
    async with request.app.state.action_lock:
        return await apply_action(run_id, operation, request)


async def apply_action(run_id: UUID, operation: Operation, request: Request):
    job = await get(run_id, request)
    if job["status"] == "completed":
        return job
    if operation.kind == "resume":
        retry_at = (job.get("error") or {}).get("retry_at")
        if retry_at and datetime.fromisoformat(retry_at) > datetime.now(UTC):
            raise HTTPException(409, "来源仍处于退避等待时间")
        if job["status"] in {"queued", "running"}:
            return job
    await request.app.state.store.update(
        run_id, "paused" if operation.kind == "pause" else "queued"
    )
    worker = request.app.state.worker
    if operation.kind == "pause" and worker.active_run == run_id and worker.active:
        worker.active.cancel()
        await asyncio.gather(worker.active, return_exceptions=True)
    return await get(run_id, request)


@app.get("/jobs/{run_id}/snapshot")
async def snapshot(run_id: UUID, request: Request):
    result = await request.app.state.store.snapshot(run_id)
    if result is None:
        raise HTTPException(409, "采集尚未完成")
    return result
