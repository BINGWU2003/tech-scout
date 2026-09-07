import asyncio
import hmac
import json
from contextlib import asynccontextmanager, suppress
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool

from .acquisition import Acquisition
from .catalog import Catalog
from .config import settings
from .llm import DeepSeek
from .models import Action, Event, ResearchError, RunView, Start
from .runtime import Runtime
from .store import Store
from .workflow import build_graph


@asynccontextmanager
async def lifespan(app):
    config = settings()
    async with AsyncConnectionPool[AsyncConnection[DictRow]](
        config.intelligence_database_url.get_secret_value(),
        open=False,
        kwargs={
            "autocommit": True,
            "row_factory": dict_row,
            "prepare_threshold": 0,
            "options": "-c search_path=agent_runtime",
        },
    ) as pool:
        await pool.wait()
        store = Store(pool, config)
        saver = AsyncPostgresSaver(pool)
        graph = build_graph(
            Catalog(config.intelligence_catalog_database_url.get_secret_value()),
            DeepSeek(config, store),
            store,
            saver,
            acquisition=Acquisition(config)
            if config.research_source_mode == "browser"
            else None,
        )
        runtime = Runtime(graph, store, config)
        app.state.store = store
        app.state.runtime = runtime
        sweeper = asyncio.create_task(runtime.sweep())
        try:
            yield
        finally:
            sweeper.cancel()
            with suppress(asyncio.CancelledError):
                await sweeper
            await runtime.close()


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
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/runs", response_model=RunView, operation_id="start_run")
async def start_run(body: Start, request: Request):
    return await request.app.state.store.create(body.run_id, body.question.strip())


@app.get("/runs/{run_id}", response_model=RunView, operation_id="get_run")
async def get_run(run_id: UUID, request: Request):
    return await request.app.state.store.get(run_id)


@app.post("/runs/{run_id}/actions", response_model=RunView, operation_id="act_on_run")
async def act_on_run(run_id: UUID, body: Action, request: Request):
    view = await request.app.state.store.action(run_id, body)
    if body.kind in {"cancel", "pause"}:
        await request.app.state.runtime.cancel(run_id)
    return view


@app.get(
    "/runs/{run_id}/events", response_model=list[Event], operation_id="list_events"
)
async def list_events(
    run_id: UUID, request: Request, after: int = Query(default=0, ge=0)
):
    return await request.app.state.store.events(run_id, after)


@app.get("/runs/{run_id}/stream", operation_id="stream_events")
async def stream_events(
    run_id: UUID, request: Request, after: int = Query(default=0, ge=0)
):
    await request.app.state.store.get(run_id)

    async def generate():
        cursor = after
        while not await request.is_disconnected():
            events = await request.app.state.store.events(run_id, cursor)
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
