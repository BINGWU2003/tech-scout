import argparse
import asyncio
import sys

import uvicorn
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from tech_scout_acquisition.browser import Browser
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


async def login():
    config = settings()
    async with Browser(config) as browser:
        closed = asyncio.Event()
        browser.context.on("close", lambda _: closed.set())
        browser.page.on("close", lambda _: closed.set())
        await browser.page.goto(
            "https://riskbird.com/",
            wait_until="domcontentloaded",
            timeout=45000,
        )
        print("请在专用浏览器完成风鸟登录，完成后关闭该浏览器窗口。", flush=True)
        while not closed.is_set():
            try:
                await browser.preserve_session()
                await asyncio.wait_for(closed.wait(), timeout=1)
            except TimeoutError:
                continue
            except Exception:
                if not closed.is_set():
                    await asyncio.sleep(1)


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
    parser.add_argument("command", choices=["login", "migrate"])
    command = parser.parse_args().command
    asyncio.run(
        login() if command == "login" else migrate_all(),
        loop_factory=loop_factory if command == "migrate" else None,
    )


if __name__ == "__main__":
    main()
