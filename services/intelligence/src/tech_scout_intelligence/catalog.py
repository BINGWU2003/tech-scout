"""Standalone read-only Catalog tools; never imports the offline pipeline."""

import json
from pathlib import PureWindowsPath
from typing import Any

from psycopg import AsyncConnection, sql
from psycopg.rows import dict_row

from .models import ResearchError

# Published dataset names, not inferred SQL table names.
TABLES = {
    "patents": ("patent", "patent_id"),
    "patent-classifications": ("patent_classification", "classification_id"),
    "patent-parties": ("patent_party", "patent_party_id"),
    "patent-domain-matches": ("patent_domain_match", "domain_match_id"),
    "companies": ("company_entity", "company_id"),
    "company-aliases": ("company_alias", "alias_id"),
    "external-identifiers": ("external_identifier", "external_identifier_id"),
    "company-relations": ("company_relation", "company_relation_id"),
    "company-patent-relations": (
        "company_patent_relation",
        "company_patent_relation_id",
    ),
    "company-candidates": ("company_candidate", "candidate_id"),
    "entity-matches": ("entity_match", "entity_match_id"),
    "entity-review-decisions": ("entity_review_decision", "candidate_id"),
    "entity-evidence": ("entity_evidence", "evidence_id"),
}


def serializable(value: Any) -> Any:
    """Keep facts, but avoid disclosing host-specific absolute source paths."""
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key in {"source_path", "manifest_path"} and isinstance(item, str):
                normalized = item.replace("\\", "/")
                for marker in ("/reviews/", "/silver/", "/bronze/", "/releases/"):
                    if marker in normalized:
                        item = normalized.split(marker, 1)[1]
                        item = marker.strip("/") + "/" + item
                        break
                else:
                    if normalized.startswith("/") or PureWindowsPath(item).drive:
                        item = PureWindowsPath(item).name
            result[key] = serializable(item)
        return result
    if isinstance(value, list):
        return [serializable(item) for item in value]
    return json.loads(json.dumps(value, default=str))


class Catalog:
    def __init__(self, url: str):
        self.url = url

    async def read(self, expected_release: str | None = None) -> dict:
        async with await AsyncConnection.connect(
            self.url,
            row_factory=dict_row,
            options="-c default_transaction_read_only=on -c statement_timeout=15000",
        ) as connection:
            await connection.execute(
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
            )
            cursor = await connection.execute(
                "SELECT * FROM catalog.dataset_release WHERE "
                "release_status = 'published' AND publishable = true "
                "AND published_at IS NOT NULL "
                "ORDER BY published_at DESC, release_id DESC LIMIT 1"
            )
            release = await cursor.fetchone()
            if not release:
                raise ResearchError("CATALOG_UNAVAILABLE", "没有已发布数据")
            rid = release["release_id"]
            if expected_release is not None and expected_release != rid:
                raise ResearchError(
                    "RELEASE_CHANGED", "数据版本已变化，请创建新运行并确认计划"
                )
            domains = await self.records(
                connection, "domains", "domain", "domain_id", rid
            )
            result = {"release": release, "domains": domains}
            if expected_release is not None:
                for kind, (table, key) in TABLES.items():
                    result[kind] = await self.records(connection, kind, table, key, rid)
                # Evaluations are audit records: only capture those backing matches.
                ids = [r["evaluation_id"] for r in result["patent-domain-matches"]]
                cursor = await connection.execute(
                    "SELECT e.* FROM catalog.patent_domain_evaluation e "
                    "JOIN catalog.dataset_record r ON r.entity_id=e.evaluation_id "
                    "AND r.entity_type='patent-domain-evaluations' AND r.release_id=%s "
                    "WHERE e.evaluation_id = ANY(%s)",
                    (rid, ids),
                )
                result["evaluations"] = await cursor.fetchall()
            return serializable(result)

    @staticmethod
    async def records(connection, kind, table, key, release):
        cursor = await connection.execute(
            sql.SQL(
                "SELECT t.* FROM catalog.{} t JOIN catalog.dataset_record r "
                "ON r.entity_id=t.{} AND r.entity_type=%s AND r.release_id=%s "
                "ORDER BY t.{} LIMIT 50001"
            ).format(sql.Identifier(table), sql.Identifier(key), sql.Identifier(key)),
            (kind, release),
        )
        rows = await cursor.fetchall()
        if len(rows) > 50000:
            raise ResearchError("SNAPSHOT_TOO_LARGE", "数据超过快照上限，未截断返回")
        return rows
