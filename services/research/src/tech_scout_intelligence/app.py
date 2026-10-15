import asyncio
import hmac
import json
from contextlib import asynccontextmanager, suppress
from typing import cast
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool

from tech_scout_acquisition.store import Store as AcquisitionStore
from tech_scout_acquisition.worker import Worker
from tech_scout_storage.database import Database

from .acquisition import Acquisition
from .config import settings
from .llm import ResearchLLM
from .models import Action, Event, ResearchError, RunView, Start
from .runtime import Runtime
from .store import Store
from .workflow import build_graph


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = settings()
    async with (
        Database(config.database_url.get_secret_value()) as database,
        Database(config.database_url.get_secret_value()) as acquisition_database,
        AsyncConnectionPool[AsyncConnection[DictRow]](
            config.database_url.get_secret_value(),
            open=False,
            kwargs={
                "autocommit": True,
                "row_factory": dict_row,
                "prepare_threshold": 0,
            },
        ) as pool,
        AsyncConnectionPool(
            config.database_url.get_secret_value(),
            open=False,
            kwargs={"autocommit": True, "row_factory": dict_row},
        ) as acquisition_pool,
    ):
        await pool.wait()
        await acquisition_pool.wait()
        acquisition_store = AcquisitionStore(acquisition_pool, acquisition_database)
        await acquisition_store.migrate()
        acquisition_worker = Worker(acquisition_store, config)
        acquisition_sweeper = asyncio.create_task(acquisition_worker.sweep())
        store = Store(pool, config, database)
        saver = AsyncPostgresSaver(pool)
        graph = build_graph(
            ResearchLLM(config, store),
            store,
            saver,
            acquisition=Acquisition(acquisition_store),
        )
        runtime = Runtime(graph, store, config)
        app.state.store = store
        app.state.runtime = runtime
        app.state.acquisition_store = acquisition_store
        app.state.acquisition_worker = acquisition_worker
        app.state.acquisition_sweeper = acquisition_sweeper
        sweeper = asyncio.create_task(runtime.sweep())
        try:
            yield
        finally:
            sweeper.cancel()
            with suppress(asyncio.CancelledError):
                await sweeper
            await runtime.close()
            acquisition_sweeper.cancel()
            with suppress(asyncio.CancelledError):
                await acquisition_sweeper


async def authenticate(authorization: str = Header(default="")):
    expected = "Bearer " + settings().intelligence_internal_token.get_secret_value()
    if not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="内部服务认证失败")


app = FastAPI(
    title="TechScout Intelligence",
    version="1.0.0",
    lifespan=lifespan,
    dependencies=[Depends(authenticate)],
)


@app.exception_handler(ResearchError)
async def research_error(request, error):
    return JSONResponse(
        status_code=404 if error.code == "RUN_NOT_FOUND" else 409,
        content={"code": error.code, "message": error.message},
    )


@app.get("/health", operation_id="health")
async def health(request: Request) -> dict[str, str]:
    if request.app.state.acquisition_sweeper.done():
        raise HTTPException(503, "采集调度器已停止，请检查服务日志")
    return {"status": "ok"}


@app.post("/runs", response_model=RunView, operation_id="start_run")
async def start_run(body: Start, request: Request):
    store = cast(Store, request.app.state.store)
    return await store.create(body.run_id, body.question.strip(), body.conversation)


@app.get("/runs/{run_id}", response_model=RunView, operation_id="get_run")
async def get_run(run_id: UUID, request: Request):
    store = cast(Store, request.app.state.store)
    return await store.get(run_id)


@app.delete("/runs/{run_id}", operation_id="delete_run")
async def delete_run(run_id: UUID, request: Request) -> dict[str, bool]:
    state = request.app.state
    store = cast(Store, state.store)
    await store.begin_delete(run_id)
    await state.runtime.cancel(run_id)
    await state.acquisition_store.update(run_id, "paused")
    worker = state.acquisition_worker
    if worker.active_run == run_id and worker.active:
        worker.active.cancel()
        await asyncio.gather(worker.active, return_exceptions=True)
    await store.delete(run_id, state.acquisition_store)
    return {"deleted": True}


@app.post("/runs/{run_id}/actions", response_model=RunView, operation_id="act_on_run")
async def act_on_run(run_id: UUID, body: Action, request: Request):
    store = cast(Store, request.app.state.store)
    view = await store.action(run_id, body)
    if body.kind in {"cancel", "pause"}:
        await request.app.state.runtime.cancel(run_id)
    return view


@app.get(
    "/runs/{run_id}/events", response_model=list[Event], operation_id="list_events"
)
async def list_events(
    run_id: UUID, request: Request, after: int = Query(default=0, ge=0)
):
    store = cast(Store, request.app.state.store)
    return await store.events(run_id, after)


@app.get("/runs/{run_id}/stream", operation_id="stream_events")
async def stream_events(
    run_id: UUID, request: Request, after: int = Query(default=0, ge=0)
):
    store = cast(Store, request.app.state.store)
    await store.get(run_id)

    async def generate():
        cursor = after
        while not await request.is_disconnected():
            try:
                events = await store.events(run_id, cursor)
            except ResearchError as error:
                if error.code == "RUN_NOT_FOUND":
                    return
                raise
            for event in events:
                cursor = event["sequence"]
                yield f"id: {cursor}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
            if not events:
                yield ": keepalive\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
