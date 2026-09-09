"""Keep Playwright's Windows subprocess loop separate from database readiness I/O."""

import asyncio
import sys
from threading import Thread

from .browser import Browser


class ThreadBrowser:
    def __init__(self, config):
        self.browser = Browser(config)

    async def call(self, coroutine):
        return await asyncio.wrap_future(
            asyncio.run_coroutine_threadsafe(coroutine, self.loop)
        )

    async def __aenter__(self):
        self.loop = (
            asyncio.ProactorEventLoop()
            if sys.platform == "win32"
            else asyncio.new_event_loop()
        )
        self.thread = Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        try:
            await self.call(self.browser.__aenter__())
        except BaseException:
            await self.stop()
            raise
        return self

    async def stop(self):
        self.loop.call_soon_threadsafe(self.loop.stop)
        await asyncio.to_thread(self.thread.join)
        self.loop.close()

    async def __aexit__(self, *args):
        try:
            await self.call(self.browser.__aexit__(*args))
        finally:
            await self.stop()

    async def search(self, url):
        return await self.call(self.browser.search(url))

    async def patent(self, number, listing):
        return await self.call(self.browser.patent(number, listing))

    async def company(self, name):
        return await self.call(self.browser.company(name))
