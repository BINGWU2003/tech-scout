from contextlib import asynccontextmanager

import pytest

from tech_scout_storage.database import advisory_lock


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["acquire", "release"])
async def test_uncertain_session_lock_discards_connection(failure):
    class Connection:
        closed = False

        async def execute(self, sql, params):
            releasing = "pg_advisory_unlock" in sql
            if (failure == "release") == releasing:
                raise RuntimeError("连接故障")
            return self

        async def fetchone(self):
            return {"acquired": True}

        async def close(self):
            self.closed = True

    connection = Connection()

    class Pool:
        @asynccontextmanager
        async def connection(self):
            yield connection

    with pytest.raises(RuntimeError, match="连接故障"):
        async with advisory_lock(Pool()):
            assert not connection.closed
    assert connection.closed
