"""Explicit live acceptance in an isolated database; resume with the same marker."""

import asyncio
import json
from pathlib import Path
from uuid import uuid4

import psycopg
from database_test_config import require_test_database_url, with_database
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from pydantic import SecretStr

from tech_scout_acquisition.config import Settings
from tech_scout_acquisition.store import Store
from tech_scout_acquisition.worker import Worker
from tech_scout_intelligence.__main__ import loop_factory
from tech_scout_storage.database import Database

MARKER = Path(__file__).resolve().parents[1] / ".local" / "acceptance.json"


async def run(marker):
    config = Settings(
        database_url=SecretStr(
            with_database(require_test_database_url(), marker["database"])
        )
    )
    async with (
        AsyncConnectionPool(
            config.database_url.get_secret_value(),
            open=False,
            kwargs={"autocommit": True, "row_factory": dict_row},
        ) as pool,
        Database(config.database_url.get_secret_value()) as database,
    ):
        await pool.wait()
        store = Store(pool, database)
        await store.migrate()
        plan = {
            "from_year": 2016,
            "to_year": 2026,
            "risks": [],
            "directions": [
                {
                    "domain_id": "solid-state-battery",
                    "name": "固态电池",
                    "keywords": ["固态电池"],
                    "excluded_keywords": [],
                    "cpc_prefixes": [],
                    "explanation": "真实网页验收，100 条唯一公开号",
                }
            ],
        }
        run_id = marker["run_id"]
        job = await store.create(run_id, plan)
        if job["status"] == "completed":
            print("Already completed; immutable release reused", flush=True)
            return
        retry_at = (job.get("error") or {}).get("retry_at")
        if retry_at:
            from datetime import UTC, datetime

            if datetime.fromisoformat(retry_at) > datetime.now(UTC):
                print("Source backoff is still active", flush=True)
                return
        await store.update(run_id, "queued")
        task = asyncio.create_task(Worker(store, config).execute(run_id))
        previous = None
        while not task.done():
            job = await store.get(run_id)
            progress = (job["status"], job["progress"])
            if progress != previous:
                print(
                    json.dumps({"status": job["status"], **job["progress"]}), flush=True
                )
                previous = progress
            await asyncio.sleep(5)
        await task
        job = await store.get(run_id)
        counts = {
            kind: len(await store.items(run_id, kind))
            for kind in ["discovered", "patent", "company"]
        }
        print(
            json.dumps(
                {
                    "status": job["status"],
                    "counts": counts,
                    "error_code": (job.get("error") or {}).get("code"),
                }
            ),
            flush=True,
        )
        MARKER.write_text(
            json.dumps({**marker, "status": job["status"], "counts": counts}, indent=2),
            encoding="utf-8",
        )


if __name__ == "__main__":
    base = require_test_database_url()
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    if MARKER.exists():
        marker = json.loads(MARKER.read_text(encoding="utf-8"))
    else:
        marker = {
            "database": "tech_scout_browser_acceptance_" + uuid4().hex[:10] + "_test",
            "run_id": str(uuid4()),
        }
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(marker["database"]))
            )
        MARKER.write_text(json.dumps(marker, indent=2), encoding="utf-8")
    print("Live acceptance uses an isolated database", flush=True)
    asyncio.run(run(marker), loop_factory=loop_factory)
