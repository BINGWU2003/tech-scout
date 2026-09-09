import argparse
import asyncio
import sys

import uvicorn
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from tech_scout_acquisition.store import Store as AcquisitionStore

from .config import settings
from .migrate import migrate as migrate_intelligence


def loop_factory():
    if sys.platform == "win32":
        import selectors

        return asyncio.SelectorEventLoop(selectors.SelectSelector())
    return asyncio.new_event_loop()


def main() -> None:
    uvicorn.run(
        "tech_scout_intelligence.app:app",
        host="127.0.0.1",
        port=8001,
        loop="asyncio:SelectorEventLoop",
    )


async def migrate_all():
    await migrate_intelligence()
    config = settings()
    async with AsyncConnectionPool(
        config.acquisition_dsn(),
        open=False,
        kwargs={"autocommit": True, "row_factory": dict_row},
    ) as pool:
        await pool.wait()
        await AcquisitionStore(pool).migrate()


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["migrate"])
    parser.parse_args()
    asyncio.run(migrate_all(), loop_factory=loop_factory)


if __name__ == "__main__":
    main()
