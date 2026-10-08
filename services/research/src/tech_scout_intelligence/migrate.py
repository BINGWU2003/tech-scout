"""Explicit runtime-only migrations: python -m tech_scout_intelligence.migrate."""

import asyncio

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection, sql
from psycopg.rows import DictRow, dict_row

from tech_scout_storage.database import migration_dsn

from .config import settings
from .store import DDL


async def reset_legacy_research(conn):
    """One-time reset when upgrading from the budget/think-mode protocol."""
    async with conn.transaction():
        legacy = await (
            await conn.execute(
                "SELECT 1 FROM information_schema.columns WHERE "
                "table_schema='agent_runtime' AND table_name='research_run' "
                "AND column_name='budget'"
            )
        ).fetchone()
        if not legacy:
            return
        # Run with both services stopped. Facts in ingestion/catalog_v2 survive.
        await conn.execute(
            "LOCK TABLE agent_runtime.research_run IN ACCESS EXCLUSIVE MODE"
        )
        rows = await (
            await conn.execute("SELECT run_id FROM agent_runtime.research_run")
        ).fetchall()
        run_ids = {row["run_id"] for row in rows}
        app_exists = await (
            await conn.execute("SELECT to_regclass('app.research_run') AS name")
        ).fetchone()
        if app_exists and app_exists["name"]:
            rows = await (
                await conn.execute("SELECT id FROM app.research_run")
            ).fetchall()
            run_ids.update(row["id"] for row in rows)
            await conn.execute("UPDATE app.research_project SET workspace='{}'::jsonb")
            await conn.execute("DELETE FROM app.research_run")
        ids = list(run_ids)
        await conn.execute(
            "INSERT INTO agent_runtime.deleted_run(run_id) "
            "SELECT unnest(%s::uuid[]) ON CONFLICT DO NOTHING",
            (ids,),
        )
        for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
            await conn.execute(
                sql.SQL("DELETE FROM agent_runtime.{} WHERE thread_id=ANY(%s)").format(
                    sql.Identifier(table)
                ),
                ([str(run_id) for run_id in ids],),
            )
        ingestion_exists = await (
            await conn.execute("SELECT to_regclass('ingestion.job') AS name")
        ).fetchone()
        if ingestion_exists and ingestion_exists["name"]:
            await conn.execute(
                "UPDATE ingestion.job SET status='paused', updated_at=now() "
                "WHERE run_id=ANY(%s) AND status IN ('queued', 'running')",
                (ids,),
            )
        for table in ("research_event", "research_action", "research_run"):
            await conn.execute(
                sql.SQL("DELETE FROM agent_runtime.{}").format(sql.Identifier(table))
            )
        await conn.execute("ALTER TABLE agent_runtime.research_run DROP COLUMN budget")


async def migrate(dsn: str | None = None):
    async with await AsyncConnection[DictRow].connect(
        migration_dsn(dsn or settings().database_url.get_secret_value()),
        autocommit=True,
        prepare_threshold=0,
        row_factory=dict_row,
        options="-c search_path=agent_runtime",
    ) as conn:
        await conn.execute(DDL, prepare=False)
        # A role/database default survives transaction pooling. This migration
        # connection is direct; its startup option is not used by runtime pools.
        current = await (
            await conn.execute("SELECT current_user AS role, current_database() AS db")
        ).fetchone()
        assert current is not None
        await conn.execute(
            sql.SQL(
                "ALTER ROLE {} IN DATABASE {} SET search_path TO agent_runtime, public"
            ).format(sql.Identifier(current["role"]), sql.Identifier(current["db"]))
        )
        await AsyncPostgresSaver(conn).setup()
        await reset_legacy_research(conn)


if __name__ == "__main__":
    asyncio.run(migrate(), loop_factory=asyncio.SelectorEventLoop)
