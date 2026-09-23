"""Durable runtime ownership, command receipts, budgets and replayable events."""

import json
from datetime import UTC, datetime

from psycopg.types.json import Jsonb

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
    def __init__(self, pool, config):
        self.pool = pool
        self.config = config

    async def create(self, run_id, question, conversation=None):
        budget = Budget(
            max_requests=self.config.research_max_requests,
            max_seconds=self.config.research_max_seconds,
            max_cny=self.config.research_max_cny,
        ).model_dump()
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 2))",
                (str(run_id),),
            )
            deleted = await conn.execute(
                "SELECT 1 FROM agent_runtime.deleted_run WHERE run_id=%s", (run_id,)
            )
            if await deleted.fetchone():
                raise ResearchError("RUN_NOT_FOUND", "研究运行已删除")
            await conn.execute(
                "INSERT INTO agent_runtime.research_run"
                "(run_id, question, budget, artifacts) "
                "VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (
                    run_id,
                    question,
                    Jsonb(budget),
                    Jsonb(
                        {
                            "execution_config": self.config.execution_policy(),
                            "conversation": conversation or {},
                            "reasoning": None,
                            "answer": None,
                        }
                    ),
                ),
            )
            row = await self.row(conn, run_id, lock=True)
            if row["question"] != question or row["artifacts"].get(
                "conversation", {}
            ) != (conversation or {}):
                raise ResearchError("IDEMPOTENCY_CONFLICT", "运行 ID 已用于不同问题")
            return self.view(row)

    @staticmethod
    async def row(conn, run_id, lock=False):
        cursor = await conn.execute(
            "SELECT * FROM agent_runtime.research_run WHERE run_id=%s"
            + (" FOR UPDATE" if lock else ""),
            (run_id,),
        )
        row = await cursor.fetchone()
        if not row:
            raise ResearchError("RUN_NOT_FOUND", "研究运行不存在")
        return row

    @staticmethod
    def view(row):
        return RunView(**{key: row[key] for key in RunView.model_fields})

    async def get(self, run_id):
        async with self.pool.connection() as conn:
            return self.view(await self.row(conn, run_id))

    async def begin_delete(self, run_id):
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 2))",
                (str(run_id),),
            )
            await conn.execute(
                "INSERT INTO agent_runtime.deleted_run VALUES (%s) "
                "ON CONFLICT DO NOTHING",
                (run_id,),
            )
            await conn.execute(
                "UPDATE agent_runtime.research_run SET status='cancelled',lease=NULL,"
                "command=NULL WHERE run_id=%s",
                (run_id,),
            )

    async def delete(self, run_id, acquisition_store):
        # Wait for checkpoint writers, including workers in another process, to exit.
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute("SET LOCAL lock_timeout = '10s'")
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (str(run_id),),
            )
            await acquisition_store.delete(run_id)
            for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                await conn.execute(
                    f"DELETE FROM agent_runtime.{table} WHERE thread_id=%s",
                    (str(run_id),),
                )
            for table in ("research_event", "research_action", "research_run"):
                await conn.execute(
                    f"DELETE FROM agent_runtime.{table} WHERE run_id=%s", (run_id,)
                )

    async def publish(self, run_id, *, lease=None, kind="state", **changes):
        async with self.pool.connection() as conn, conn.transaction():
            row = await self.row(conn, run_id, lock=True)
            if lease is not None and row["lease"] != lease:
                raise ResearchError("LEASE_LOST", "执行租约已失效")
            return await self.update(conn, row, kind, changes)

    async def update(self, conn, row, kind, changes):
        row.update(changes)
        row["sequence"] += 1
        view = self.view(row)
        await conn.execute(
            "UPDATE agent_runtime.research_run SET status=%s, sequence=%s, "
            "node=%s,error=%s,artifacts=%s,budget=%s,lease=%s,command=%s "
            "WHERE run_id=%s",
            (
                row["status"],
                row["sequence"],
                row["node"],
                Jsonb(row["error"]),
                Jsonb(row["artifacts"]),
                Jsonb(row["budget"]),
                row["lease"],
                Jsonb(row["command"]),
                row["run_id"],
            ),
        )
        await conn.execute(
            "INSERT INTO agent_runtime.research_event(run_id,sequence,kind,data) "
            "VALUES (%s,%s,%s,%s)",
            (row["run_id"], row["sequence"], kind, Jsonb(view.model_dump(mode="json"))),
        )
        return view

    async def claim(self, run_id, lease):
        async with self.pool.connection() as conn, conn.transaction():
            try:
                row = await self.row(conn, run_id, lock=True)
            except ResearchError as error:
                if error.code == "RUN_NOT_FOUND":
                    return None
                raise
            if row["status"] != "queued":
                return None
            await conn.execute(
                "UPDATE agent_runtime.research_run SET heartbeat=now() WHERE run_id=%s",
                (run_id,),
            )
            await self.update(
                conn, row, "started", {"status": "running", "lease": lease}
            )
            return row

    async def action(self, run_id, action):
        payload = action.model_dump(mode="json")
        async with self.pool.connection() as conn, conn.transaction():
            row = await self.row(conn, run_id, lock=True)
            previous = await conn.execute(
                "SELECT payload FROM agent_runtime.research_action "
                "WHERE run_id=%s AND action_id=%s",
                (run_id, action.action_id),
            )
            receipt = await previous.fetchone()
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
                "INSERT INTO agent_runtime.research_action VALUES (%s,%s,%s)",
                (run_id, action.action_id, Jsonb(payload)),
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
                budget["max_requests"] = max(budget["max_requests"], self.config.research_max_requests)
                budget["max_seconds"] = max(budget["max_seconds"], self.config.research_max_seconds)
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
        async with self.pool.connection() as conn, conn.transaction():
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
        async with self.pool.connection() as conn, conn.transaction():
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
        async with self.pool.connection() as conn, conn.transaction():
            row = await self.row(conn, run_id, lock=True)
            if row["lease"] != lease:
                raise ResearchError("LEASE_LOST", "执行租约已失效")
            row["budget"]["elapsed_seconds"] += seconds
            await conn.execute(
                "UPDATE agent_runtime.research_run SET heartbeat=now(),budget=%s "
                "WHERE run_id=%s",
                (Jsonb(row["budget"]), run_id),
            )

    async def pending(self):
        async with self.pool.connection() as conn, conn.transaction():
            cursor = await conn.execute(
                "SELECT * FROM agent_runtime.research_run WHERE status='running' "
                "AND heartbeat < now() - interval '20 seconds' FOR UPDATE"
            )
            for row in await cursor.fetchall():
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
                "SELECT run_id FROM agent_runtime.research_run WHERE status='queued' "
                "ORDER BY created_at LIMIT 20"
            )
            return [r["run_id"] for r in await cursor.fetchall()]

    async def events(self, run_id, after):
        async with self.pool.connection() as conn:
            await self.row(conn, run_id)
            cursor = await conn.execute(
                "SELECT sequence,kind,created_at,data "
                "FROM agent_runtime.research_event "
                "WHERE run_id=%s AND sequence>%s ORDER BY sequence LIMIT 20",
                (run_id, after),
            )
            return json.loads(json.dumps(await cursor.fetchall(), default=str))


def validate_plan(plan, context):
    if plan.to_year > context["period_to_year"]:
        raise ResearchError("PLAN_OUT_OF_SCOPE", "结束年份不能晚于当前年份")
    ids = [d.domain_id for d in plan.directions]
    if len(ids) != len(set(ids)):
        raise ResearchError("PLAN_OUT_OF_SCOPE", "检索方向标识不能重复")
