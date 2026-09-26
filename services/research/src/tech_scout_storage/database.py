"""Short ORM transactions with transaction-scoped PostgreSQL locks."""

from psycopg import AsyncConnection
from psycopg.conninfo import conninfo_to_dict, make_conninfo
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


def migration_dsn(dsn: str) -> str:
    """Neon schema migrations use a direct connection, runtime uses the pooler."""
    params = conninfo_to_dict(dsn)
    host = params.get("host", "")
    if host.endswith(".neon.tech") and "-pooler." in host:
        params["host"] = host.replace("-pooler.", ".", 1)
        return make_conninfo(**params)
    return dsn
