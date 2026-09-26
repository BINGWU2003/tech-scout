"""Explicit runtime-only migrations: python -m tech_scout_intelligence.migrate."""

import asyncio

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection, sql
from psycopg.rows import DictRow, dict_row

from tech_scout_storage.database import migration_dsn

from .config import settings
from .store import DDL


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


if __name__ == "__main__":
    asyncio.run(migrate(), loop_factory=asyncio.SelectorEventLoop)
