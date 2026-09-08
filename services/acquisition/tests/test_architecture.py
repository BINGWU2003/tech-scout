import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
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


def test_cleanup_preserves_accounts_browser_runs_and_unknowns():
    dsn = os.environ.get("TEST_ACQUISITION_DATABASE_URL")
    if not dsn:
        pytest.skip("独立测试数据库未配置")
    path = Path(__file__).resolve().parents[1] / "scripts/cleanup_legacy.py"
    spec = importlib.util.spec_from_file_location("cleanup_legacy", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with psycopg.connect(dsn) as conn:
        account = uuid4()
        conn.execute(
            "INSERT INTO app.user_account(id,username,email,normalized_email,"
            "password_hash,updated_at) VALUES(%s,%s,%s,%s,'test-hash',now())",
            (
                account,
                str(account)[:20],
                f"{account}@test.local",
                f"{account}@test.local",
            ),
        )
        before = conn.execute("SELECT count(*) FROM app.user_account").fetchone()[0]
        old, new, unknown = uuid4(), uuid4(), uuid4()
        for rid, version in ((old, "phase2-v1"), (new, "browser-v1"), (unknown, "")):
            conn.execute(
                "INSERT INTO "
                "agent_runtime.research_run(run_id,question,budget,artifacts) "
                "VALUES(%s,'test','{}',%s)",
                (rid, Jsonb({"execution_config": {"workflow_version": version}})),
            )
            conn.execute(
                "INSERT INTO app.research_project"
                "(id,user_id,title,question,request_key) "
                "VALUES(%s,%s,'fixture','fixture',%s)",
                (rid, account, uuid4()),
            )
            conn.execute(
                "INSERT INTO app.research_run"
                "(id,project_id,request_key,question,updated_at) "
                "VALUES(%s,%s,%s,'fixture',now())",
                (rid, rid, uuid4()),
            )
        for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
            from psycopg import sql

            conn.execute(
                sql.SQL(
                    "CREATE TABLE IF NOT EXISTS agent_runtime.{} (thread_id text)"
                ).format(sql.Identifier(table))
            )
            conn.execute(
                sql.SQL("INSERT INTO agent_runtime.{}(thread_id) VALUES(%s)").format(
                    sql.Identifier(table)
                ),
                (str(old),),
            )
        conn.execute(
            "CREATE SCHEMA IF NOT EXISTS catalog; CREATE TABLE catalog.obsolete(id int)"
        )
        report = module.cleanup(conn)
        assert str(old) in report["legacy_runs"]
        assert str(new) in report["preserved_runs"]
        assert str(unknown) in report["unclassified_runs"]
        assert (
            conn.execute(
                "SELECT count(*) FROM app.user_account WHERE id=%s", (account,)
            ).fetchone()[0]
            == 1
        )
        assert (
            conn.execute(
                "SELECT count(*) FROM app.research_project WHERE id=%s", (old,)
            ).fetchone()[0]
            == 0
        )
        assert (
            conn.execute(
                "SELECT count(*) FROM app.research_project WHERE id=ANY(%s)",
                ([new, unknown],),
            ).fetchone()[0]
            == 2
        )
        assert (
            conn.execute("SELECT count(*) FROM app.user_account").fetchone()[0]
            == before
        )
        assert (
            conn.execute(
                "SELECT count(*) FROM agent_runtime.research_run WHERE run_id=ANY(%s)",
                ([new, unknown],),
            ).fetchone()[0]
            == 2
        )
        assert not module.cleanup(conn)["legacy_runs"]
        conn.rollback()
