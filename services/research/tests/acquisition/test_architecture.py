import os
from uuid import uuid4

import pytest
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from test_acquisition import company, patent, plan

from tech_scout_acquisition.store import Store


@pytest.mark.asyncio
async def test_cumulative_sources_partial_progress_and_frozen_snapshot():
    dsn = os.environ.get("TEST_ACQUISITION_DATABASE_URL")
    if not dsn:
        pytest.skip("独立测试数据库未配置")
    async with AsyncConnectionPool(
        dsn, open=False, kwargs={"autocommit": True, "row_factory": dict_row}
    ) as pool:
        await pool.wait()
        store = Store(pool)
        await store.migrate()
        first, second = uuid4(), uuid4()
        await store.create(first, plan())
        await store.save(first, "patent", "CNARCHA1", patent("CNARCHA1"))
        co = company()
        await store.save(first, "company", "example", {"companies": [co]})
        await store.update(first, "running")
        await store.publish(first, {"frozen": True})
        await store.create(second, plan())
        await store.save(
            second,
            "patent",
            "CNARCHA1",
            {**patent("CNARCHA1"), "title": "更新后的固态电池"},
        )
        await store.save(second, "patent", "CNARCHB1", patent("CNARCHB1"))
        await store.save(second, "company", "example", {"companies": [co]})
        await store.update(second, "paused")
        async with pool.connection() as conn:
            assert (
                await (
                    await conn.execute(
                        "SELECT count(*) n FROM catalog_v2.record_source "
                        "WHERE record_id='CNARCHA1'"
                    )
                ).fetchone()
            )["n"] == 2
            assert (
                await (
                    await conn.execute(
                        "SELECT count(*) n FROM catalog_v2.company WHERE "
                        "credit_code=%s",
                        (co["credit_code"],),
                    )
                ).fetchone()
            )["n"] == 1
            assert (
                await (
                    await conn.execute(
                        "SELECT snapshot FROM catalog_v2.run_projection "
                        "WHERE run_id=%s",
                        (second,),
                    )
                ).fetchone()
            )["snapshot"]["patents"]
        assert await store.snapshot(first) == {"frozen": True}
        assert (await store.get(second))["status"] == "paused"
