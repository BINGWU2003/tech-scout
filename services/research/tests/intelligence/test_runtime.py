import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool
from test_workflow import FakeAcquisition, FakeLLM, plan

from tech_scout_intelligence.config import Settings
from tech_scout_intelligence.models import Action, ResearchError
from tech_scout_intelligence.runtime import Runtime
from tech_scout_intelligence.store import DDL, Store
from tech_scout_intelligence.workflow import build_graph

DSN = os.environ.get("TEST_INTELLIGENCE_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DSN, reason="独立 TEST_INTELLIGENCE_DATABASE_URL 未配置"
)


@pytest_asyncio.fixture
async def setup_runtime():
    if DSN is None:
        pytest.skip("独立 TEST_INTELLIGENCE_DATABASE_URL 未配置")
    config = Settings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        intelligence_database_url=DSN,
        intelligence_internal_token="test-token-" * 4,
    )
    async with AsyncConnectionPool[AsyncConnection[DictRow]](
        DSN,
        open=False,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": dict_row,
            "options": "-c search_path=agent_runtime",
        },
    ) as pool:
        await pool.wait()
        async with pool.connection() as conn:
            await conn.execute(DDL, prepare=False)
        saver = AsyncPostgresSaver(pool)
        await saver.setup()
        store = Store(pool, config)
        catalog, llm = FakeAcquisition(), FakeLLM()
        graph = build_graph(llm, store, saver, catalog)
        runtime = Runtime(graph, store, config)
        yield runtime, store, catalog, llm, saver
        await runtime.close()


@pytest.mark.asyncio
async def test_postgres_restart_resume_budget_and_event_receipts(setup_runtime):
    runtime, store, catalog, llm, saver = setup_runtime
    run_id = uuid4()
    await store.create(run_id, "工业视觉")
    await runtime.execute(run_id)
    state = await store.get(run_id)
    assert state.status == "awaiting_plan"
    action = Action(
        action_id=uuid4(), actor_id=uuid4(), kind="confirm_plan", plan=plan()
    )
    first = await store.action(run_id, action)
    second = await store.action(run_id, action)
    assert first.sequence == second.sequence
    runtime.config.deepseek_model = "changed-after-run-start"
    assert (await store.get(run_id)).artifacts["execution_config"][
        "model"
    ] == "deepseek-v4-flash"
    # A new graph/runtime instance consumes the persisted checkpoint and command.
    resumed = Runtime(build_graph(llm, store, saver, catalog), store, runtime.config)
    await resumed.execute(run_id)
    state = await store.get(run_id)
    assert state.status == "completed", state.error
    assert state.artifacts["result"]["companies"][0]["patent_count"] == 1
    assert llm.calls.count("Plan") == 1
    assert state.budget.elapsed_seconds > 0
    events, after = [], 0
    while batch := await store.events(run_id, after):
        events.extend(batch)
        after = events[-1]["sequence"]
    assert [e["sequence"] for e in events] == list(range(1, state.sequence + 1))
    assert events[-1]["kind"] == "execution_stopped"


@pytest.mark.asyncio
async def test_failed_planner_allows_manual_plan_without_another_model_call(
    setup_runtime,
):
    runtime, store, _, llm, _ = setup_runtime
    run_id = uuid4()
    llm.fail = "Plan"
    await store.create(run_id, "视觉")
    await runtime.execute(run_id)
    failed = await store.get(run_id)
    assert failed.status == "failed"
    assert failed.node == "planner"
    assert "snapshot" not in failed.artifacts
    await store.action(
        run_id,
        Action(action_id=uuid4(), actor_id=uuid4(), kind="confirm_plan", plan=plan()),
    )
    await runtime.execute(run_id)
    assert (await store.get(run_id)).status == "completed"
    assert llm.calls == ["Plan", "Analysis"]


@pytest.mark.asyncio
async def test_failed_analysis_stops_then_explicit_retry_reuses_facts(setup_runtime):
    runtime, store, catalog, llm, _ = setup_runtime
    run_id = uuid4()
    await store.create(run_id, "视觉")
    await runtime.execute(run_id)
    await store.action(
        run_id,
        Action(action_id=uuid4(), actor_id=uuid4(), kind="confirm_plan", plan=plan()),
    )
    llm.fail = "Analysis"
    await runtime.execute(run_id)
    failed = await store.get(run_id)
    assert failed.status == "failed"
    assert "result" not in failed.artifacts
    catalog.data["release"]["release_id"] = "v2"
    llm.fail = None
    await store.action(
        run_id, Action(action_id=uuid4(), actor_id=uuid4(), kind="retry")
    )
    await runtime.execute(run_id)
    finished = await store.get(run_id)
    assert finished.status == "completed"
    assert finished.artifacts["result"]["release_id"] == "v1"
    assert finished.budget.elapsed_seconds >= failed.budget.elapsed_seconds


@pytest.mark.asyncio
async def test_claim_budget_cancel_and_expired_lease(setup_runtime):
    _, store, _, _, _ = setup_runtime
    run_id, lease = uuid4(), uuid4()
    await store.create(run_id, "视觉")
    claimed = await asyncio.gather(
        store.claim(run_id, lease), store.claim(run_id, uuid4())
    )
    assert sum(row is not None for row in claimed) == 1
    # Inspect the winning lease rather than assuming concurrent scheduling order.
    async with store.pool.connection() as conn:
        row = await store.row(conn, run_id)
    lease = row["lease"]
    for _ in range(6):
        await store.reserve(run_id, lease, 0.01)
    with pytest.raises(ResearchError, match="预算不足"):
        await store.reserve(run_id, lease, 0.01)
    async with store.pool.connection() as conn:
        await conn.execute(
            "UPDATE agent_runtime.research_run SET heartbeat=%s WHERE run_id=%s",
            (datetime.now(UTC) - timedelta(seconds=30), run_id),
        )
    await store.pending()
    recovered = await store.get(run_id)
    assert recovered.status == "recoverable"
    assert recovered.budget.requests == 6
    with pytest.raises(ResearchError, match="租约"):
        await store.publish(run_id, lease=lease, status="completed")
    await store.action(
        run_id, Action(action_id=uuid4(), actor_id=uuid4(), kind="cancel")
    )
    assert (await store.get(run_id)).status == "cancelled"


@pytest.mark.asyncio
async def test_idempotency_and_financial_reservation(setup_runtime):
    _, store, _, _, _ = setup_runtime
    run_id, lease = uuid4(), uuid4()
    await store.create(run_id, "原问题")
    with pytest.raises(ResearchError, match="不同问题"):
        await store.create(run_id, "不同问题")
    await store.claim(run_id, lease)
    await store.reserve(run_id, lease, 0.9)
    with pytest.raises(ResearchError, match="预算不足"):
        await store.reserve(run_id, lease, 0.2)
    assert (await store.get(run_id)).budget.requests == 1


@pytest.mark.asyncio
async def test_heartbeat_failure_stops_node_before_checkpoint(
    setup_runtime, monkeypatch
):
    runtime, store, _, llm, _ = setup_runtime
    run_id = uuid4()
    entered = asyncio.Event()
    cancelled = asyncio.Event()
    original_heartbeat = store.heartbeat

    async def blocked_model(*args, **kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    async def failing_heartbeat(rid, lease, seconds):
        if entered.is_set() and seconds > 0:
            raise ConnectionError("simulated heartbeat failure")
        return await original_heartbeat(rid, lease, seconds)

    monkeypatch.setattr(llm, "generate", blocked_model)
    monkeypatch.setattr(store, "heartbeat", failing_heartbeat)
    await store.create(run_id, "视觉")
    await asyncio.wait_for(runtime.execute(run_id), timeout=8)
    assert cancelled.is_set()
    current = await store.get(run_id)
    assert current.status == "recoverable"
    state = await runtime.graph.aget_state({"configurable": {"thread_id": str(run_id)}})
    assert "plan" not in state.values
    assert state.next == ("planner",)


@pytest.mark.asyncio
async def test_time_limit_stops_and_cannot_reset_by_retry(setup_runtime):
    runtime, store, _, llm, _ = setup_runtime
    run_id = uuid4()
    await store.create(run_id, "视觉")
    async with store.pool.connection() as conn:
        await conn.execute(
            "UPDATE agent_runtime.research_run SET budget="
            "jsonb_set(budget,'{elapsed_seconds}','301') WHERE run_id=%s",
            (run_id,),
        )
    await runtime.execute(run_id)
    first = await store.get(run_id)
    assert first.status == "failed"
    assert first.error.code == "TIME_BUDGET_EXCEEDED"
    await store.action(
        run_id, Action(action_id=uuid4(), actor_id=uuid4(), kind="retry")
    )
    await runtime.execute(run_id)
    second = await store.get(run_id)
    assert second.error.code == "TIME_BUDGET_EXCEEDED"
    assert not llm.calls


@pytest.mark.asyncio
async def test_cancel_running_model_never_continues(setup_runtime, monkeypatch):
    runtime, store, _, llm, _ = setup_runtime
    entered = asyncio.Event()
    run_id = uuid4()

    async def wait_forever(*args, **kwargs):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(llm, "generate", wait_forever)
    await store.create(run_id, "视觉")
    task = asyncio.create_task(runtime.execute(run_id))
    runtime.tasks[run_id] = task
    await asyncio.wait_for(entered.wait(), timeout=5)
    await store.action(
        run_id, Action(action_id=uuid4(), actor_id=uuid4(), kind="cancel")
    )
    await runtime.cancel(run_id)
    await asyncio.wait_for(task, timeout=5)
    current = await store.get(run_id)
    assert current.status == "cancelled"
    assert "snapshot" not in current.artifacts
    assert "result" not in current.artifacts
