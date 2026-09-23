"""Remove pre-v3 local research runs and their run-scoped data."""

import argparse
from collections import defaultdict

from psycopg import connect
from psycopg.conninfo import conninfo_to_dict

from tech_scout_intelligence.config import settings


LOCAL_HOSTS = {None, "", "localhost", "127.0.0.1", "::1"}


def database_identity(dsn: str) -> tuple[str | None, str | None, str | None]:
    info = conninfo_to_dict(dsn)
    if info.get("host") not in LOCAL_HOSTS:
        raise SystemExit("仅允许清理本地数据库")
    return info.get("host"), info.get("port"), info.get("dbname")


def cleanup(confirm: bool) -> None:
    config = settings()
    dsn = config.intelligence_database_url.get_secret_value()
    if database_identity(dsn) != database_identity(config.acquisition_dsn()):
        raise SystemExit("运行库与采集库不在同一本地数据库，无法原子清理")

    with connect(dsn, connect_timeout=5) as conn, conn.transaction():
        conn.execute("SET LOCAL lock_timeout = '10s'")
        conn.execute("SELECT id FROM app.research_project FOR UPDATE")
        rows = conn.execute(
            "SELECT id, project_id, status, "
            "state #>> '{artifacts,execution_config,workflow_version}' "
            "FROM app.research_run FOR UPDATE"
        ).fetchall()
        by_project = defaultdict(set)
        for _, project_id, _, version in rows:
            by_project[project_id].add(version)
        old = [row for row in rows if row[3] not in {None, "browser-v3"}]
        if any(
            "browser-v3" in by_project[row[1]] or None in by_project[row[1]]
            for row in old
        ):
            raise SystemExit("发现新旧轮次混合的项目，已停止清理")
        if any(row[2] in {"queued", "running"} for row in old):
            raise SystemExit("旧版轮次仍在执行，请先停止研究服务")
        ids = [row[0] for row in old]
        projects = list({row[1] for row in old})
        print(f"legacy_runs={len(ids)} legacy_projects={len(projects)}")
        if not confirm or not ids:
            return

        patent_ids = [
            row[0] for row in conn.execute(
                "SELECT DISTINCT record_id FROM catalog_v2.record_source "
                "WHERE kind='patent' AND run_id = ANY(%s)", (ids,)
            )
        ]
        company_ids = [
            row[0] for row in conn.execute(
                "SELECT DISTINCT record_id FROM catalog_v2.record_source "
                "WHERE kind='company' AND run_id = ANY(%s)", (ids,)
            )
        ]
        conn.execute("DELETE FROM catalog_v2.release WHERE release_id = ANY(%s)", (ids,))
        for table in (
            "catalog_v2.record_source",
            "catalog_v2.run_projection",
            "ingestion.item",
            "ingestion.event",
            "ingestion.job",
            "agent_runtime.research_event",
            "agent_runtime.research_action",
        ):
            conn.execute(f"DELETE FROM {table} WHERE run_id = ANY(%s)", (ids,))
        thread_ids = [str(run_id) for run_id in ids]
        for table in (
            "agent_runtime.checkpoint_writes",
            "agent_runtime.checkpoint_blobs",
            "agent_runtime.checkpoints",
        ):
            conn.execute(
                f"DELETE FROM {table} WHERE thread_id = ANY(%s)", (thread_ids,)
            )
        conn.execute("DELETE FROM agent_runtime.research_run WHERE run_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM agent_runtime.deleted_run WHERE run_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM app.research_project WHERE id = ANY(%s)", (projects,))
        conn.execute(
            "DELETE FROM catalog_v2.patent p WHERE p.publication_number = ANY(%s) "
            "AND NOT EXISTS (SELECT 1 FROM catalog_v2.record_source s "
            "WHERE s.kind='patent' AND s.record_id=p.publication_number)",
            (patent_ids,),
        )
        conn.execute(
            "DELETE FROM catalog_v2.company c WHERE c.company_id::text = ANY(%s) "
            "AND NOT EXISTS (SELECT 1 FROM catalog_v2.record_source s "
            "WHERE s.kind='company' AND s.record_id=c.company_id::text)",
            (company_ids,),
        )
        print("Legacy research cleaned; v3 runs and referenced facts retained.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-cleanup-legacy-research", action="store_true")
    args = parser.parse_args()
    cleanup(args.confirm_cleanup_legacy_research)
