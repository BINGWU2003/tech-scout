import asyncio
import time
from contextlib import suppress
from uuid import uuid4

import structlog
from langgraph.types import Command

from .models import ResearchError

log = structlog.get_logger()


class Runtime:
    def __init__(self, graph, store, config):
        self.graph = graph
        self.store = store
        self.config = config
        self.tasks = {}
        self.closed = False

    async def sweep(self):
        while not self.closed:
            try:
                for run_id in await self.store.pending():
                    if (
                        run_id not in self.tasks
                        and len(self.tasks) < self.config.research_max_parallel
                    ):
                        task = asyncio.create_task(self.execute(run_id))
                        self.tasks[run_id] = task
                        task.add_done_callback(
                            lambda _, rid=run_id: self.tasks.pop(rid, None)
                        )
            except Exception:
                log.error("runtime_sweep_failed")
            await asyncio.sleep(1)

    async def close(self):
        self.closed = True
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def cancel(self, run_id):
        task = self.tasks.get(run_id)
        if task:
            task.cancel()

    async def execute(self, run_id):
        # A session lock fences checkpoint writers even during lease handover.
        async with self.store.pool.connection() as guard:
            cursor = await guard.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired",
                (str(run_id),),
            )
            if not (await cursor.fetchone())["acquired"]:
                return
            try:
                await self._execute(run_id)
            finally:
                await guard.execute(
                    "SELECT pg_advisory_unlock(hashtextextended(%s, 0))",
                    (str(run_id),),
                )

    async def _execute(self, run_id):
        lease = uuid4()
        row = await self.store.claim(run_id, lease)
        if not row:
            return
        config = {"configurable": {"thread_id": str(run_id), "lease": lease}}
        last_tick = time.monotonic()
        started = last_tick
        executor = asyncio.current_task()

        async def pulse():
            nonlocal last_tick
            try:
                while True:
                    await asyncio.sleep(2)
                    now = time.monotonic()
                    await self.store.heartbeat(run_id, lease, now - last_tick)
                    last_tick = now
            except Exception:
                log.warning("research_heartbeat_failed", run_id=str(run_id))
                executor.cancel()

        heartbeat = asyncio.create_task(pulse())
        try:
            remaining = row["budget"]["max_seconds"] - row["budget"]["elapsed_seconds"]
            if remaining <= 0:
                raise ResearchError("TIME_BUDGET_EXCEEDED", "执行时间预算已用完")
            async with asyncio.timeout(remaining):
                saved = await self.graph.aget_state(config)
                command = row["command"] or {}
                value = None if saved.values else {"question": row["question"]}
                if command.get("kind") == "confirm_plan" and saved.next == ("planner",):
                    await self.graph.aupdate_state(
                        config,
                        {
                            "plan": command["plan"],
                            "confirmed_plan": command["plan"],
                        },
                        as_node="planner",
                    )
                    value = None
                elif command.get("kind") in {"confirm_plan", "resolve_entities"}:
                    value = Command(resume=command)
                elif command.get("kind") == "retry" and any(
                    t.interrupts for t in saved.tasks
                ):
                    resume = row["artifacts"].get("resume_command")
                    if resume:
                        value = Command(resume=resume)
                async for state in self.graph.astream(
                    value, config, stream_mode="values", durability="sync"
                ):
                    current = await self.store.get(run_id)
                    artifacts = {
                        **current.artifacts,
                        **{
                            key: val
                            for key, val in state.items()
                            if not key.startswith("__")
                        },
                    }
                    await self.store.publish(
                        run_id, lease=lease, kind="node_completed", artifacts=artifacts
                    )
                saved = await self.graph.aget_state(config)
                if saved.next:
                    status = (
                        "awaiting_plan"
                        if "plan_gate" in saved.next
                        else "awaiting_entities"
                    )
                else:
                    status = (
                        "completed"
                        if saved.values.get("result", {}).get("companies")
                        else "empty"
                    )
                await self.store.publish(
                    run_id,
                    lease=lease,
                    status=status,
                    error=None,
                    command=None,
                    kind=status,
                )
        except asyncio.CancelledError:
            current = await self.store.get(run_id)
            if current.status != "cancelled":
                with suppress(Exception):
                    await self.store.publish(
                        run_id,
                        lease=lease,
                        status="recoverable",
                        kind="interrupted",
                        error={
                            "code": "WORKER_INTERRUPTED",
                            "message": "执行中断，可主动恢复",
                        },
                    )
        except Exception as exc:
            if isinstance(exc, ResearchError):
                code, message = exc.code, exc.message
            elif isinstance(exc, TimeoutError):
                code, message = "TIME_BUDGET_EXCEEDED", "执行时间预算已用完"
            else:
                code, message = (
                    "NODE_FAILED",
                    "研究节点执行失败，请查看服务运行状态后主动重试",
                )
            if code != "LEASE_LOST":
                with suppress(Exception):
                    current = await self.store.get(run_id)
                    await self.store.publish(
                        run_id,
                        lease=lease,
                        status="failed",
                        kind="failed",
                        error={"code": code, "message": message, "node": current.node},
                    )
            log.warning("research_failed", run_id=str(run_id), code=code)
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await heartbeat
            with suppress(Exception):
                await self.store.heartbeat(run_id, lease, time.monotonic() - last_tick)
                # Publish final usage so NestJS never stores an earlier time counter.
                current = await self.store.get(run_id)
                await self.store.publish(
                    run_id,
                    lease=lease,
                    kind="execution_stopped",
                    budget=current.budget.model_dump(),
                )
            log.info(
                "research_execution_stopped",
                run_id=str(run_id),
                seconds=time.monotonic() - started,
            )
