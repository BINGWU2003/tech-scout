import os
from pathlib import Path
from typing import LiteralString, cast
from uuid import uuid4

import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection, sql
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool
from test_workflow import FakeAcquisition, FakeLLM

from tech_scout_intelligence.config import Settings
from tech_scout_intelligence.migrate import migrate
from tech_scout_intelligence.models import ResearchError
from tech_scout_intelligence.runtime import Runtime
from tech_scout_intelligence.store import Store
from tech_scout_intelligence.workflow import build_graph
from tech_scout_storage.database import Database

DSN = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="独立 TEST_DATABASE_URL 未配置")


@pytest.mark.asyncio
async def test_legacy_reset_preserves_facts_and_does_not_repeat():
    assert DSN is not None
    await migrate(DSN)
    async with await AsyncConnection[DictRow].connect(
        DSN, autocommit=True, row_factory=dict_row
    ) as conn:
        app = await (
            await conn.execute("SELECT to_regclass('app.user_account') AS name")
        ).fetchone()
        assert app is not None
        if not app["name"]:
            root = Path(__file__).resolve().parents[4]
            for migration in sorted(
                (root / "apps/api/prisma/migrations").glob("*/migration.sql")
            ):
                await conn.execute(migration.read_bytes(), prepare=False)
        await conn.execute(
            (
                Path(__file__).resolve().parents[2]
                / "src/tech_scout_acquisition/schema.sql"
            ).read_bytes(),
            prepare=False,
        )

    config = Settings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        database_url=DSN,
        intelligence_internal_token="test-token-" * 4,
    )  # pyright: ignore[reportCallIssue]
    run_id, project_id, user_id, company_id = uuid4(), uuid4(), uuid4(), uuid4()
    publication = "cleanup-" + run_id.hex
    async with (
        AsyncConnectionPool[AsyncConnection[DictRow]](
            DSN, open=False, kwargs={"autocommit": True, "row_factory": dict_row}
        ) as pool,
        Database(DSN) as database,
    ):
        await pool.wait()
        store = Store(pool, config, database)
        saver = AsyncPostgresSaver(pool)
        runtime = Runtime(
            build_graph(FakeLLM(), store, saver, FakeAcquisition()), store, config
        )
        await store.create(run_id, "旧研究")
        await runtime.execute(run_id)
        async with pool.connection() as conn:
            await conn.execute(
                "ALTER TABLE agent_runtime.research_run ADD COLUMN budget "
                "jsonb NOT NULL DEFAULT '{}'::jsonb"
            )
            username = "cleanup_" + user_id.hex[:16]
            await conn.execute(
                "INSERT INTO "
                "app.user_account(id,username,email,normalized_email,password_hash,updated_at)"
                " VALUES (%s,%s,%s,%s,'unused',now())",
                (
                    user_id,
                    username,
                    username + "@example.com",
                    username + "@example.com",
                ),
            )
            await conn.execute(
                "INSERT INTO "
                "app.research_project(id,user_id,title,question,request_key,workspace)"
                " VALUES "
                "(%s,%s,'旧项目','旧研究',%s,'{\"changes\":[{\"text\":\"历史对话\"}]}')",
                (project_id, user_id, uuid4()),
            )
            await conn.execute(
                "INSERT INTO "
                "app.research_run(id,project_id,request_key,question,updated_at,state,context)"
                " VALUES "
                '(%s,%s,%s,\'旧研究\',now(),\'{"budget":{},"artifacts":{"reasoning":{}}}\',\'{"thinking":true}\')',
                (run_id, project_id, uuid4()),
            )
            await conn.execute(
                "INSERT INTO "
                "app.research_event(run_id,sequence,kind,data,created_at) "
                "VALUES (%s,1,'reasoning_progress','{}',now())",
                (run_id,),
            )
            await conn.execute(
                "INSERT INTO app.research_command(id,run_id,payload) VALUES "
                "(%s,%s,'{}')",
                (uuid4(), run_id),
            )
            await conn.execute(
                "INSERT INTO "
                "agent_runtime.research_action(run_id,action_id,payload) "
                "VALUES (%s,%s,'{}')",
                (run_id, uuid4()),
            )
            await conn.execute(
                "INSERT INTO ingestion.job(run_id,plan,status) VALUES "
                "(%s,'{}','running')",
                (run_id,),
            )
            await conn.execute(
                "INSERT INTO catalog_v2.patent(publication_number,data) "
                'VALUES (%s,\'{"title":"保留专利"}\')',
                (publication,),
            )
            await conn.execute(
                "INSERT INTO catalog_v2.company(company_id,credit_code,data) "
                'VALUES (%s,%s,\'{"name":"保留企业"}\')',
                (company_id, company_id.hex),
            )
            await conn.execute(
                "INSERT INTO catalog_v2.release(release_id,snapshot) VALUES "
                "(%s,'{\"patents\":[]}')",
                (run_id,),
            )
        await migrate(DSN)
        with pytest.raises(ResearchError, match="已删除"):
            await store.create(run_id, "延迟的旧请求")
        async with pool.connection() as conn:
            for table in ("research_run", "research_event", "research_action"):
                row = await (
                    await conn.execute(
                        f"SELECT count(*) AS n FROM agent_runtime.{table} "
                        "WHERE run_id=%s",
                        (run_id,),
                    )
                ).fetchone()
                assert row is not None and row["n"] == 0
            for table in ("research_run", "research_event", "research_command"):
                key = "id" if table == "research_run" else "run_id"
                row = await (
                    await conn.execute(
                        f"SELECT count(*) AS n FROM app.{table} WHERE {key}=%s",
                        (run_id,),
                    )
                ).fetchone()
                assert row is not None and row["n"] == 0
            for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
                row = await (
                    await conn.execute(
                        f"SELECT count(*) AS n FROM agent_runtime.{table} "
                        "WHERE thread_id=%s",
                        (str(run_id),),
                    )
                ).fetchone()
                assert row is not None and row["n"] == 0
            for query, params in (
                ("SELECT id FROM app.user_account WHERE id=%s", (user_id,)),
                (
                    "SELECT id FROM app.research_project WHERE id=%s AND "
                    "workspace='{}'::jsonb",
                    (project_id,),
                ),
                (
                    "SELECT run_id FROM ingestion.job WHERE run_id=%s AND "
                    "status='paused'",
                    (run_id,),
                ),
                (
                    "SELECT publication_number FROM catalog_v2.patent WHERE "
                    "publication_number=%s AND data->>'title'='保留专利'",
                    (publication,),
                ),
                (
                    "SELECT company_id FROM catalog_v2.company WHERE "
                    "company_id=%s AND data->>'name'='保留企业'",
                    (company_id,),
                ),
                (
                    "SELECT release_id FROM catalog_v2.release WHERE release_id=%s",
                    (run_id,),
                ),
            ):
                assert (
                    await (
                        await conn.execute(sql.SQL(cast(LiteralString, query)), params)
                    ).fetchone()
                    is not None
                )
            assert (
                await (
                    await conn.execute(
                        "SELECT 1 FROM information_schema.columns WHERE "
                        "table_schema='agent_runtime' AND table_name='research_run' "
                        "AND column_name='budget'"
                    )
                ).fetchone()
                is None
            )
        new_run = uuid4()
        await store.create(new_run, "新研究")
        await migrate(DSN)
        assert (await store.get(new_run)).status == "queued"
