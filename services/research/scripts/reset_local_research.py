"""Destructively reset local research data while preserving authentication data."""

import argparse
import asyncio

from psycopg import AsyncConnection
from psycopg.conninfo import conninfo_to_dict

from tech_scout_intelligence.config import settings

CONFIRMATION = "--confirm-reset-local-research"
LOCAL_HOSTS = {None, "", "localhost", "127.0.0.1", "::1"}


def assert_local_dsn(dsn: str) -> None:
    host = conninfo_to_dict(dsn).get("host")
    if host not in LOCAL_HOSTS:
        raise SystemExit(f"拒绝重置非本地数据库主机：{host}")


async def reset_database(dsn: str, statements: list[str]) -> None:
    async with await AsyncConnection.connect(dsn, autocommit=True) as conn:
        for statement in statements:
            await conn.execute(statement)


async def reset() -> None:
    config = settings()
    intelligence_dsn = config.intelligence_database_url.get_secret_value()
    acquisition_dsn = config.acquisition_dsn()
    assert_local_dsn(intelligence_dsn)
    assert_local_dsn(acquisition_dsn)
    await reset_database(
        intelligence_dsn,
        [
            "TRUNCATE TABLE app.research_project CASCADE",
            "TRUNCATE TABLE agent_runtime.checkpoint_writes, "
            "agent_runtime.checkpoint_blobs, agent_runtime.checkpoints, "
            "agent_runtime.research_event, agent_runtime.research_action, "
            "agent_runtime.research_run, agent_runtime.deleted_run CASCADE",
        ],
    )
    await reset_database(
        acquisition_dsn,
        [
            "TRUNCATE TABLE catalog_v2.record_source, catalog_v2.run_projection, "
            "catalog_v2.release, catalog_v2.patent, catalog_v2.company, "
            "ingestion.event, ingestion.item, ingestion.company_cache, "
            "ingestion.job CASCADE"
        ],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(CONFIRMATION, action="store_true")
    args = parser.parse_args()
    if not args.confirm_reset_local_research:
        parser.error(f"必须显式传入 {CONFIRMATION}；此操作不可恢复")
    asyncio.run(reset(), loop_factory=asyncio.SelectorEventLoop)
    print("已清空本地研究、采集、目录和检查点数据；账号与会话未删除。")


if __name__ == "__main__":
    main()
