"""Explicit runtime-only migrations: python -m tech_scout_intelligence.migrate."""

import asyncio

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import dict_row

from .config import settings
from .store import DDL


async def migrate():
    async with await AsyncConnection.connect(
        settings().intelligence_database_url.get_secret_value(),
        autocommit=True,
        prepare_threshold=0,
        row_factory=dict_row,
        options="-c search_path=agent_runtime",
    ) as conn:
        await conn.execute(DDL, prepare=False)
        await AsyncPostgresSaver(conn).setup()


if __name__ == "__main__":
    asyncio.run(migrate(), loop_factory=asyncio.SelectorEventLoop)
