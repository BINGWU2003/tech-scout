"""Durable runtime ownership, command receipts, budgets and replayable events."""

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, null, select, update
from sqlalchemy.dialects.postgresql import insert

from tech_scout_storage.database import (
    Database,
    advisory_lock,
    delete_checkpoints,
    deletion_lock,
    transaction_lock,
)
from tech_scout_storage.models import (
    DeletedRun,
    ResearchAction,
    ResearchEvent,
    ResearchRun,
)

from .models import Budget, ResearchError, RunView

DDL = """
CREATE SCHEMA IF NOT EXISTS agent_runtime;
-- Keep only the identifier so delayed start requests cannot recreate deleted work.
CREATE TABLE IF NOT EXISTS agent_runtime.deleted_run (
    run_id uuid PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS agent_runtime.research_run (
    run_id uuid PRIMARY KEY,
    question text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    sequence integer NOT NULL DEFAULT 0,
    node text,
    error jsonb,
    artifacts jsonb NOT NULL DEFAULT '{}',
    budget jsonb NOT NULL,
    command jsonb,
    lease uuid,
    heartbeat timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_runtime.research_event (
    run_id uuid NOT NULL REFERENCES agent_runtime.research_run(run_id),
    sequence integer NOT NULL,
    kind text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    data jsonb NOT NULL,
    PRIMARY KEY (run_id, sequence)
);
CREATE TABLE IF NOT EXISTS agent_runtime.research_action (
    run_id uuid NOT NULL REFERENCES agent_runtime.research_run(run_id),
    action_id uuid NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (run_id, action_id)
);
"""


class Store:
    def __init__(self, pool, config, database: Database):
        self.pool = pool
        self.config = config
        self.database = database

    def run_lock(self, run_id):
        return advisory_lock(self.pool, run_id, 0)

    async def create(self, run_id, question, conversation=None):
        budget = Budget(
            max_requests=self.config.research_max_requests,
            max_seconds=self.config.research_max_seconds,
            max_cny=self.config.research_max_cny,
        ).model_dump()
        async with self.database.transaction() as conn:
            await transaction_lock(conn, run_id, 2)
            deleted = await conn.execute(
                select(DeletedRun.run_id).where(DeletedRun.run_id == run_id)
            )
            if deleted.first():
                raise ResearchError("RUN_NOT_FOUND", "研究运行已删除")
            await conn.execute(
                insert(ResearchRun)
                .values(
                    run_id=run_id,
                    question=question,
                    budget=budget,
                    artifacts={
                        "execution_config": self.config.execution_policy(),
                        "conversation": conversation or {},
                        "reasoning": None,
                        "answer": None,
                    },
                )
                .on_conflict_do_nothing()
            )
            row = await self.row(conn, run_id, lock=True)
            if row["question"] != question or row["artifacts"].get(
                "conversation", {}
            ) != (conversation or {}):
                raise ResearchError("IDEMPOTENCY_CONFLICT", "运行 ID 已用于不同问题")
            return self.view(row)

    @staticmethod
    async def row(conn, run_id, lock=False):
        statement = select(ResearchRun.__table__).where(ResearchRun.run_id == run_id)
        if lock:
            statement = statement.with_for_update()
        cursor = await conn.execute(statement)
        found = cursor.mappings().first()
        row = dict(found) if found is not None else None
        if not row:
            raise ResearchError("RUN_NOT_FOUND", "研究运行不存在")
        return row

    @staticmethod
    def view(row):
        return RunView(**{key: row[key] for key in RunView.model_fields})

    async def get(self, run_id):
        async with self.database.transaction() as conn:
            return self.view(await self.row(conn, run_id))

    async def begin_delete(self, run_id):
        async with self.database.transaction() as conn:
            await transaction_lock(conn, run_id, 2)
            await conn.execute(
                insert(DeletedRun).values(run_id=run_id).on_conflict_do_nothing()
            )
            await conn.execute(
                update(ResearchRun)
                .where(ResearchRun.run_id == run_id)
                .values(status="cancelled", lease=None, command=null())
            )

    async def delete(self, run_id, acquisition_store):
        # Wait for checkpoint writers, including workers in another process, to exit.
        async with self.database.transaction() as conn:
            await deletion_lock(conn, run_id, 0)
            await acquisition_store.delete(run_id)
            await delete_checkpoints(conn, run_id)
            for model in (ResearchEvent, ResearchAction, ResearchRun):
                await conn.execute(delete(model).where(model.run_id == run_id))

    async def publish(self, run_id, *, lease=None, kind="state", **changes):
        async with self.database.transaction() as conn:
            row = await self.row(conn, run_id, lock=True)
            if lease is not None and row["lease"] != lease:
                raise ResearchError("LEASE_LOST", "执行租约已失效")
            return await self.update(conn, row, kind, changes)

    async def update(self, conn, row, kind, changes):
        row.update(changes)
        row["sequence"] += 1
        view = self.view(row)
        await conn.execute(
            update(ResearchRun)
            .where(ResearchRun.run_id == row["run_id"])
            .values(
                **{
                    key: row[key]
                    for key in (
                        "status",
                        "sequence",
                        "node",
                        "error",
                        "artifacts",
                        "budget",
                        "lease",
                        "command",
                    )
                }
            )
        )
        await conn.execute(
            insert(ResearchEvent).values(
                run_id=row["run_id"],
                sequence=row["sequence"],
                kind=kind,
                data=view.model_dump(mode="json"),
            )
        )
        return view

    async def claim(self, run_id, lease):
        async with self.database.transaction() as conn:
            try:
                row = await self.row(conn, run_id, lock=True)
            except ResearchError as error:
                if error.code == "RUN_NOT_FOUND":
                    return None
                raise
            if row["status"] != "queued":
                return None
            await conn.execute(
                update(ResearchRun)
                .where(ResearchRun.run_id == run_id)
                .values(heartbeat=func.now())
            )
            await self.update(
                conn, row, "started", {"status": "running", "lease": lease}
            )
            return row

    async def action(self, run_id, action):
        payload = action.model_dump(mode="json")
        async with self.database.transaction() as conn:
            row = await self.row(conn, run_id, lock=True)
            previous = await conn.execute(
                select(ResearchAction.payload).where(
                    ResearchAction.run_id == run_id,
                    ResearchAction.action_id == action.action_id,
                )
            )
            receipt = previous.mappings().first()
            if receipt:
                if receipt["payload"] != payload:
                    raise ResearchError("IDEMPOTENCY_CONFLICT", "动作 ID 内容不一致")
                return self.view(row)
            allowed = {
                "confirm_plan": {"awaiting_plan", "failed"},
                "start_companies": {"awaiting_companies"},
                "retry": {"failed", "recoverable"},
                "pause": {"queued", "running"},
                "cancel": {
                    "queued",
                    "running",
                    "awaiting_plan",
                    "awaiting_companies",
                    "failed",
                    "recoverable",
                },
            }
            if row["status"] not in allowed[action.kind]:
                raise ResearchError("INVALID_STATE", "当前状态不接受此动作")
            if action.kind == "confirm_plan":
                if row["status"] == "failed" and row["node"] != "planner":
                    raise ResearchError("INVALID_STATE", "只能替换规划失败的计划")
                validate_plan(action.plan, row["artifacts"]["context"])
            await conn.execute(
                insert(ResearchAction).values(
                    run_id=run_id, action_id=action.action_id, payload=payload
                )
            )
            changes = {
                "status": (
                    "cancelled"
                    if action.kind == "cancel"
                    else "recoverable"
                    if action.kind == "pause"
                    else "queued"
                ),
                "lease": None,
                "command": payload,
                "error": None,
            }
            if action.kind == "retry":
                budget = row["budget"]
                budget["max_requests"] = max(
                    budget["max_requests"], self.config.research_max_requests
                )
                budget["max_seconds"] = max(
                    budget["max_seconds"], self.config.research_max_seconds
                )
                budget["max_cny"] = max(budget["max_cny"], self.config.research_max_cny)
                changes["budget"] = budget
            if action.kind in {"confirm_plan", "start_companies"}:
                payload = {**payload, "submitted_at": datetime.now(UTC).isoformat()}
                artifacts = row["artifacts"]
                artifacts["resume_command"] = payload
                artifacts.setdefault("confirmations", []).append(payload)
                changes.update(command=payload, artifacts=artifacts)
            return await self.update(conn, row, action.kind, changes)

    async def reserve(self, run_id, lease, cost):
        async with self.database.transaction() as conn:
            row = await self.row(conn, run_id, lock=True)
            if row["lease"] != lease:
                raise ResearchError("LEASE_LOST", "执行租约已失效")
            budget = row["budget"]
            if (
                budget["requests"] >= budget["max_requests"]
                or budget["reserved_cny"] + cost > budget["max_cny"]
            ):
                raise ResearchError("BUDGET_EXCEEDED", "模型请求次数或费用预算不足")
            budget["requests"] += 1
            budget["reserved_cny"] += cost
            await self.update(conn, row, "model_reserved", {"budget": budget})

    async def usage(self, run_id, lease, usage, model):
        async with self.database.transaction() as conn:
            row = await self.row(conn, run_id, lock=True)
            if row["lease"] != lease:
                return
            budget = row["budget"]
            budget["input_tokens"] += usage.prompt_tokens
            budget["output_tokens"] += usage.completion_tokens
            policy = row["artifacts"]["execution_config"]
            budget["estimated_cny"] += (
                usage.prompt_tokens * policy["input_cny_per_million"]
                + usage.completion_tokens * policy["output_cny_per_million"]
            ) / 1_000_000
            artifacts = row["artifacts"]
            artifacts.setdefault("model_calls", []).append(
                {
                    "configured_model": policy["model"],
                    "response_model": model,
                    "input_tokens": usage.prompt_tokens,
                    "output_tokens": usage.completion_tokens,
                }
            )
            await self.update(
                conn, row, "model_usage", {"budget": budget, "artifacts": artifacts}
            )

    async def heartbeat(self, run_id, lease, seconds):
        async with self.database.transaction() as conn:
            row = await self.row(conn, run_id, lock=True)
            if row["lease"] != lease:
                raise ResearchError("LEASE_LOST", "执行租约已失效")
            row["budget"]["elapsed_seconds"] += seconds
            await conn.execute(
                update(ResearchRun)
                .where(ResearchRun.run_id == run_id)
                .values(heartbeat=func.now(), budget=row["budget"])
            )

    async def pending(self):
        async with self.database.transaction() as conn:
            cursor = await conn.execute(
                select(ResearchRun.__table__)
                .where(
                    ResearchRun.status == "running",
                    ResearchRun.heartbeat < func.now() - timedelta(seconds=20),
                )
                .with_for_update()
            )
            for row in [dict(r) for r in cursor.mappings()]:
                # Charge time since heartbeat on crash; never reset a run's budget.
                elapsed = (datetime.now(UTC) - row["heartbeat"]).total_seconds()
                collecting = (
                    row["node"] in {"snapshot", "company_snapshot"}
                    and row["artifacts"].get("context", {}).get("source_mode")
                    == "browser"
                )
                if not collecting:
                    row["budget"]["elapsed_seconds"] += min(elapsed, 20)
                await self.update(
                    conn,
                    row,
                    "recoverable",
                    {
                        "status": "recoverable",
                        "lease": None,
                        "error": {
                            "code": "WORKER_INTERRUPTED",
                            "message": "执行中断，可主动恢复",
                        },
                    },
                )
            cursor = await conn.execute(
                select(ResearchRun.run_id)
                .where(ResearchRun.status == "queued")
                .order_by(ResearchRun.created_at)
                .limit(20)
            )
            return list(cursor.scalars())

    async def events(self, run_id, after):
        async with self.database.transaction() as conn:
            await self.row(conn, run_id)
            cursor = await conn.execute(
                select(
                    ResearchEvent.sequence,
                    ResearchEvent.kind,
                    ResearchEvent.created_at,
                    ResearchEvent.data,
                )
                .where(ResearchEvent.run_id == run_id, ResearchEvent.sequence > after)
                .order_by(ResearchEvent.sequence)
                .limit(20)
            )
            return json.loads(
                json.dumps([dict(r) for r in cursor.mappings()], default=str)
            )


def validate_plan(plan, context):
    if plan.to_year > context["period_to_year"]:
        raise ResearchError("PLAN_OUT_OF_SCOPE", "结束年份不能晚于当前年份")
    ids = [d.domain_id for d in plan.directions]
    if len(ids) != len(set(ids)):
        raise ResearchError("PLAN_OUT_OF_SCOPE", "检索方向标识不能重复")
