"""Provision a disposable database and run the architecture regression suites."""

import ast
import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4

import psycopg
from database_test_config import require_test_database_url, with_database
from psycopg import sql

ROOT = Path(__file__).resolve().parents[3]


def main():
    database = "tech_scout_architecture_" + uuid4().hex[:12] + "_test"
    base = require_test_database_url()
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
    dsn = with_database(base, database)
    with psycopg.connect(dsn) as conn:
        for migration in sorted(
            (ROOT / "apps/api/prisma/migrations").glob("*/migration.sql")
        ):
            conn.execute(migration.read_text(encoding="utf-8"))
        tree = ast.parse(
            (ROOT / "services/research/src/tech_scout_intelligence/store.py").read_text(
                encoding="utf-8"
            )
        )
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "DDL" for t in node.targets
            ):
                conn.execute(ast.literal_eval(node.value))
        conn.execute(
            (
                ROOT / "services/research/src/tech_scout_acquisition/schema.sql"
            ).read_text(encoding="utf-8")
        )
    marker = ROOT / "services/research/.local/architecture-test.json"
    marker.parent.mkdir(exist_ok=True)
    marker.write_text(json.dumps({"database": database}), encoding="utf-8")
    env = {
        **os.environ,
        "PYTHONUTF8": "1",
        "TEST_DATABASE_URL": dsn,
    }
    subprocess.run(
        [
            "uv",
            "run",
            "--project",
            "services/research",
            "pytest",
            "services/research/tests",
            "-q",
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )
    subprocess.run(
        [
            "pnpm.cmd" if os.name == "nt" else "pnpm",
            "--filter",
            "@tech-scout/api",
            "test:e2e",
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )
    print(json.dumps({"database": database, "status": "passed"}))


if __name__ == "__main__":
    main()
