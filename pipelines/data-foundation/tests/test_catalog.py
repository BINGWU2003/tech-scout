import json
from pathlib import Path

import pytest

from data_foundation.datasets.catalog import (
    SPEC_BY_DATASET,
    CatalogError,
    _domain_rows,
    _include_expected_zero_counts,
    migration_paths,
    read_db_config,
)


def test_catalog_counts_include_expected_empty_datasets() -> None:
    expected = {"patents": 2, "entity-review": 0}

    assert _include_expected_zero_counts({"patents": 2}, expected) == expected


def test_catalog_counts_preserve_unexpected_datasets() -> None:
    expected = {"patents": 2, "entity-review": 0}

    assert _include_expected_zero_counts(
        {"patents": 2, "unexpected": 1}, expected
    ) == {"patents": 2, "entity-review": 0, "unexpected": 1}


def test_read_chinese_database_config(tmp_path: Path) -> None:
    config = tmp_path / "db.txt"
    config.write_text(
        "主机：localhost\n端口：5432\n数据库：tech_scout\n"
        "用户名：postgres\n密码：secret\n",
        encoding="utf-8",
    )

    assert read_db_config(config) == {
        "host": "localhost",
        "port": 5432,
        "dbname": "tech_scout",
        "user": "postgres",
        "password": "secret",
    }


def test_read_database_config_rejects_missing_password(tmp_path: Path) -> None:
    config = tmp_path / "db.txt"
    config.write_text(
        "HOST=localhost\nPORT=5432\nDATABASE=tech_scout\nUSER=postgres\n",
        encoding="utf-8",
    )

    with pytest.raises(CatalogError, match="password"):
        read_db_config(config)


def test_domain_rows_preserve_full_definition(tmp_path: Path) -> None:
    path = tmp_path / "domains.jsonl"
    value = {
        "domainId": "ai-chip",
        "name": "AI chip",
        "ruleVersion": "v1",
        "period": {"fromYear": 2019, "toYear": 2025},
    }
    path.write_text(json.dumps(value) + "\n", encoding="utf-8")

    row = next(iter(_domain_rows(path)))

    assert row[:3] == ("ai-chip", "AI chip", "v1")
    assert json.loads(row[3]) == value


def test_catalog_specs_cover_silver_outputs() -> None:
    assert set(SPEC_BY_DATASET) == {
        "patent-domain-evaluations",
        "patents",
        "patent-classifications",
        "patent-parties",
        "patent-domain-matches",
        "company-candidates",
        "entity-matches",
        "companies",
        "company-aliases",
        "external-identifiers",
        "company-relations",
        "company-patent-relations",
        "entity-review-decisions",
        "entity-evidence",
        "entity-review",
        "domains",
    }


def test_catalog_migrations_are_ordered_and_include_review_audit() -> None:
    paths = migration_paths()

    assert [path.name for path in paths] == ["001_catalog.sql", "002_review_audit.sql"]
