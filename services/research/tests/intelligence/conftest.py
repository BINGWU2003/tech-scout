import asyncio


def pytest_asyncio_loop_factories():
    # psycopg async is incompatible with Windows' default Proactor loop.
    return {"selector": asyncio.SelectorEventLoop}
