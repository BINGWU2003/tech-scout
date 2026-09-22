import importlib.util
import sys
from pathlib import Path

import pytest
from pydantic import SecretStr

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/reset_local_research.py"
SPEC = importlib.util.spec_from_file_location("reset_local_research", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
assert_local_dsn = module.assert_local_dsn


def test_reset_only_accepts_local_database_hosts():
    assert_local_dsn("postgresql://tester:secret@127.0.0.1:5432/research")
    assert_local_dsn("postgresql://tester:secret@localhost:5432/research")
    with pytest.raises(SystemExit, match="非本地"):
        assert_local_dsn("postgresql://tester:secret@db.example.com/research")


def test_reset_requires_explicit_confirmation(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["reset_local_research.py"])
    with pytest.raises(SystemExit) as caught:
        module.main()
    assert caught.value.code == 2


@pytest.mark.asyncio
async def test_reset_targets_only_research_domains(monkeypatch):
    class LocalSettings:
        intelligence_database_url = SecretStr(
            "postgresql://tester:secret@localhost/research"
        )

        def acquisition_dsn(self):
            return "postgresql://tester:secret@localhost/research"

    statements = []

    async def record(dsn, sql):
        statements.extend(sql)

    monkeypatch.setattr(module, "settings", LocalSettings)
    monkeypatch.setattr(module, "reset_database", record)
    await module.reset()
    text = "\n".join(statements).lower()
    for table in (
        "app.research_project",
        "agent_runtime.research_run",
        "agent_runtime.checkpoints",
        "agent_runtime.deleted_run",
        "ingestion.job",
        "ingestion.company_cache",
        "catalog_v2.patent",
        "catalog_v2.company",
        "catalog_v2.release",
    ):
        assert table in text
    assert "app.user_account" not in text
    assert "app.user_session" not in text
