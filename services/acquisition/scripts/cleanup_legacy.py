"""Remove positively identified offline research and its retired schemas.

Run while API/Intelligence are stopped. Default is a read-only inventory.
Never resets accounts or deletes unclassified runs. No browser credentials read.
"""

import argparse
import json
import os

import psycopg
from psycopg import sql

from tech_scout_acquisition.config import settings


def inventory(conn):
    rows = conn.execute("""
        SELECT COALESCE(r.run_id,a.id), r.artifacts, a.state
        FROM agent_runtime.research_run r FULL JOIN app.research_run a ON a.id=r.run_id
    """).fetchall()
    jobs = {str(r[0]) for r in conn.execute("SELECT run_id FROM ingestion.job")}
    old, keep, unknown = [], [], []
    for run_id, artifacts, state in rows:
        a = artifacts or (state or {}).get("artifacts", {})
        rid = str(run_id or (state or {}).get("run_id", ""))
        context = a.get("context", {})
        version = a.get("execution_config", {}).get("workflow_version", "")
        if (
            rid in jobs
            or context.get("source_mode") == "browser"
            or version.startswith("browser-")
        ):
            keep.append(rid)
        elif (
            context.get("source_mode") == "catalog"
            or version == "phase2-v1"
            or (
                context.get("release", {}).get("release_id")
                and context.get("source_mode") != "browser"
            )
        ):
            old.append(rid)
        else:
            unknown.append(rid)
    return {"legacy_runs": old, "preserved_runs": keep, "unclassified_runs": unknown}


def cleanup(conn):
    report = inventory(conn)
    ids = report["legacy_runs"]
    projects = [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT project_id FROM app.research_run WHERE id=ANY(%s::uuid[])",
            (ids,),
        )
    ]
    # Explicit table list; no CASCADE across unrelated schemas.
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
        if conn.execute(
            "SELECT to_regclass(%s)", (f"agent_runtime.{table}",)
        ).fetchone()[0]:
            conn.execute(
                sql.SQL(
                    "DELETE FROM agent_runtime.{} WHERE thread_id = ANY(%s)"
                ).format(sql.Identifier(table)),
                (ids,),
            )
    for schema, table, key in (
        ("agent_runtime", "research_action", "run_id"),
        ("agent_runtime", "research_event", "run_id"),
        ("agent_runtime", "research_run", "run_id"),
        ("app", "research_command", "run_id"),
        ("app", "research_event", "run_id"),
        ("app", "research_run", "id"),
    ):
        conn.execute(
            sql.SQL("DELETE FROM {}.{} WHERE {} = ANY(%s::uuid[])").format(
                sql.Identifier(schema), sql.Identifier(table), sql.Identifier(key)
            ),
            (ids,),
        )
    conn.execute(
        "DELETE FROM app.research_project p WHERE id=ANY(%s::uuid[]) "
        "AND NOT EXISTS (SELECT 1 FROM app.research_run r WHERE r.project_id=p.id)",
        (projects,),
    )
    # Reject external dependencies, then drop only retired tables together.
    objects = conn.execute(
        "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN "
        "('catalog','staging') ORDER BY schemaname,tablename"
    ).fetchall()
    if objects:
        conn.execute(
            sql.SQL("DROP TABLE {} RESTRICT").format(
                sql.SQL(",").join(sql.Identifier(*r) for r in objects)
            )
        )
    for schema in ("catalog", "staging"):
        conn.execute(
            sql.SQL("DROP SCHEMA IF EXISTS {} RESTRICT").format(sql.Identifier(schema))
        )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    dsn = (
        os.environ.get("CLEANUP_DATABASE_URL")
        or settings().acquisition_database_url.get_secret_value()
    )
    with psycopg.connect(dsn) as conn:
        report = cleanup(conn) if args.apply else inventory(conn)
        print(json.dumps(report, ensure_ascii=False))
