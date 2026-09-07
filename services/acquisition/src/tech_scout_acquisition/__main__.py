import argparse
import asyncio
import sys

import uvicorn
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .browser import Browser
from .config import settings
from .store import Store


def loop_factory():
    if sys.platform == "win32":
        import selectors

        return asyncio.SelectorEventLoop(selectors.SelectSelector())
    return asyncio.new_event_loop()


def main():
    # Browser subprocesses run on their own dedicated thread and event loop.
    uvicorn.run(
        "tech_scout_acquisition.app:app",
        host="127.0.0.1",
        port=8002,
        loop="tech_scout_acquisition.__main__:loop_factory",
    )


async def maintenance(command):
    config = settings()
    if command == "migrate":
        async with AsyncConnectionPool(
            config.acquisition_database_url.get_secret_value(),
            open=False,
            kwargs={"autocommit": True, "row_factory": dict_row},
        ) as pool:
            await pool.wait()
            await Store(pool).migrate()
    else:
        async with Browser(config) as browser:
            closed = asyncio.Event()
            browser.context.on("close", lambda _: closed.set())
            await browser.page.goto("https://riskbird.com/")
            print("请在专用浏览器完成登录，完成后关闭该浏览器窗口。", flush=True)
            while not closed.is_set():
                try:
                    await browser.preserve_session()
                    await asyncio.wait_for(closed.wait(), timeout=1)
                except TimeoutError:
                    continue
                except Exception:
                    if not closed.is_set():
                        await asyncio.sleep(1)


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["login", "migrate"])
    command = parser.parse_args().command
    asyncio.run(
        maintenance(command),
        loop_factory=loop_factory if command == "migrate" else None,
    )


if __name__ == "__main__":
    main()
