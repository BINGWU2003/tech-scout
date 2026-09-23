"""Short ORM transactions and separately owned PostgreSQL session locks."""

from contextlib import asynccontextmanager

from psycopg import AsyncConnection
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


class Database:
    def __init__(self, dsn: str):
        # psycopg parses both libpq connection strings and URLs, including options.
        async def connect():
            return await AsyncConnection.connect(dsn)

        self.engine = create_async_engine(
            "postgresql+psycopg://",
            async_creator=connect,
            pool_size=4,
            max_overflow=0,
            pool_pre_ping=True,
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.engine.dispose()

    def transaction(self):
        return self.sessions.begin()


async def transaction_lock(session, run_id, namespace: int):
    await session.execute(
        select(
            func.pg_advisory_xact_lock(func.hashtextextended(str(run_id), namespace))
        )
    )


async def deletion_lock(session, run_id, namespace: int):
    await session.execute(text("SET LOCAL lock_timeout = '10s'"))
    await transaction_lock(session, run_id, namespace)


async def delete_checkpoints(session, run_id):
    # Third-party tables belong to LangGraph; never map/migrate them as ORM models.
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
        await session.execute(
            text(f"DELETE FROM agent_runtime.{table} WHERE thread_id=:thread_id"),
            {"thread_id": str(run_id)},
        )


@asynccontextmanager
async def advisory_lock(pool, run_id=None, namespace=0, *, wait=False):
    """Pin a connection; an uncertain acquisition/release discards the session."""
    async with pool.connection() as connection:
        expression = "hashtextextended(%s, %s)" if run_id is not None else "%s"
        params = (str(run_id), namespace) if run_id is not None else (720260907,)
        function = "pg_advisory_lock" if wait else "pg_try_advisory_lock"
        try:
            cursor = await connection.execute(
                f"SELECT {function}({expression}) AS acquired", params
            )
            row = await cursor.fetchone()
            acquired = wait or bool(row["acquired"])
        except BaseException:
            await connection.close()
            raise
        try:
            yield acquired
        finally:
            if acquired:
                try:
                    cursor = await connection.execute(
                        f"SELECT pg_advisory_unlock({expression}) AS released", params
                    )
                    row = await cursor.fetchone()
                    if not row["released"]:
                        raise RuntimeError("数据库会话锁未持有")
                except BaseException:
                    await connection.close()
                    raise
