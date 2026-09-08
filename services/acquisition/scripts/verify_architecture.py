"""Provision a disposable database and run the architecture regression suites."""

import ast
import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

from tech_scout_acquisition.config import settings

ROOT = Path(__file__).resolve().parents[3]


def main():
    database = "tech_scout_architecture_" + uuid4().hex[:12] + "_test"
    base = settings().acquisition_database_url.get_secret_value()
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
    dsn = make_conninfo(base, dbname=database)
    with psycopg.connect(dsn) as conn:
        for migration in sorted(
            (ROOT / "apps/api/prisma/migrations").glob("*/migration.sql")
        ):
            conn.execute(migration.read_text(encoding="utf-8"))
        tree = ast.parse(
            (
                ROOT / "services/intelligence/src/tech_scout_intelligence/store.py"
            ).read_text(encoding="utf-8")
        )
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "DDL" for t in node.targets
            ):
                conn.execute(ast.literal_eval(node.value))
        conn.execute(
            (
                ROOT / "services/acquisition/src/tech_scout_acquisition/schema.sql"
            ).read_text(encoding="utf-8")
        )
    marker = ROOT / "services/acquisition/.local/architecture-test.json"
    marker.parent.mkdir(exist_ok=True)
    marker.write_text(json.dumps({"database": database}), encoding="utf-8")
    env = {
        **os.environ,
        "PYTHONUTF8": "1",
        "TEST_ACQUISITION_DATABASE_URL": dsn,
        "TEST_INTELLIGENCE_DATABASE_URL": dsn,
    }
    for project in ("acquisition", "intelligence"):
        subprocess.run(
            [
                "uv",
                "run",
                "--project",
                f"services/{project}",
                "pytest",
                f"services/{project}/tests",
                "-q",
            ],
            cwd=ROOT,
            env=env,
            check=True,
        )
    # pg (Node) requires a URL; construct it without displaying credentials.
    from urllib.parse import quote

    from psycopg.conninfo import conninfo_to_dict

    parts = conninfo_to_dict(dsn)
    user = quote(parts.get("user", ""), safe="")
    password = quote(parts.get("password", ""), safe="")
    host = parts.get("host", "localhost")
    port = parts.get("port", "5432")
    url = f"postgresql://{user}:{password}@{host}:{port}/{database}"
    env.update(
        TEST_DATABASE_URL=url, TEST_CATALOG_DATABASE_URL=url, CATALOG_DATABASE_URL=url
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
