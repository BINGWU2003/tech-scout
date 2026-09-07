import os
from uuid import uuid4

import pytest
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from tech_scout_acquisition.models import AcquisitionBlocked
from tech_scout_acquisition.store import Store


@pytest.mark.asyncio
async def test_database_idempotency_pause_and_immutable_release():
    dsn = os.environ.get("TEST_ACQUISITION_DATABASE_URL")
    if not dsn:
        pytest.skip("需要独立采集测试数据库")
    async with AsyncConnectionPool(
        dsn,
        open=False,
        kwargs={
            "autocommit": True,
            "row_factory": dict_row,
        },
    ) as pool:
        await pool.wait()
        store = Store(pool)
        await store.migrate()
        run = uuid4()
        await store.create(run, {"directions": []})
        await store.create(run, {"directions": []})
        with pytest.raises(ValueError):
            await store.create(run, {"directions": ["changed"]})
        for _ in range(2):
            await store.save(run, "patent", "CN123B", {"title": "真实来源测试夹具"})
        other = uuid4()
        await store.create(other, {})
        await store.save(other, "patent", "CN123B", {"title": "更新"})
        async with pool.connection() as conn:
            count = await conn.execute("SELECT count(*) AS n FROM catalog_v2.patent")
            assert (await count.fetchone())["n"] == 1
        await store.update(run, "paused")
        with pytest.raises(AcquisitionBlocked):
            await store.checkpoint(run, {})
        with pytest.raises(AcquisitionBlocked):
            await store.publish(run, {"version": 1})
        assert await store.snapshot(run) is None
        await store.update(run, "queued")
        await store.checkpoint(run, {})
        await store.publish(run, {"version": 1})
        await store.update(run, "running")
        await store.publish(run, {"version": 2})
        assert await store.snapshot(run) == {"version": 1}
