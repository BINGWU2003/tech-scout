"""Reset collected source data while preserving users and research history.

The default mode only prints an inventory. Pass ``--apply`` to remove acquisition
items, catalog projections and releases, then requeue acquisition jobs. Browser
profiles and application/intelligence schemas are never accessed.
"""

import argparse
import json
import os

import psycopg

from tech_scout_acquisition.config import settings

TABLES = (
    "ingestion.item",
    "ingestion.company_cache",
    "catalog_v2.record_source",
    "catalog_v2.run_projection",
    "catalog_v2.release",
    "catalog_v2.patent",
    "catalog_v2.company",
)


def inventory(conn):
    counts = {
        table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in TABLES
    }
    counts["ingestion.job"] = conn.execute(
        "SELECT count(*) FROM ingestion.job"
    ).fetchone()[0]
    return counts


def reset(conn):
    before = inventory(conn)
    for table in (
        "catalog_v2.release",
        "catalog_v2.record_source",
        "catalog_v2.run_projection",
        "ingestion.item",
        "ingestion.company_cache",
        "catalog_v2.patent",
        "catalog_v2.company",
    ):
        conn.execute(f"DELETE FROM {table}")
    conn.execute(
        "UPDATE ingestion.job SET status='queued',progress='{}',error=NULL,"
        "updated_at=now()"
    )
    return {"before": before, "after": inventory(conn)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    dsn = (
        os.environ.get("RESET_SOURCE_DATABASE_URL")
        or settings().acquisition_dsn()
    )
    with psycopg.connect(dsn) as conn:
        report = reset(conn) if args.apply else inventory(conn)
        print(json.dumps(report, ensure_ascii=False))
