"""Publish a verified Silver release into a local PostgreSQL catalog."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb
import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from intelligence.datasets.silver import SilverError, verify_silver


class CatalogError(RuntimeError):
    """Raised when migration, import, or catalog verification fails."""


@dataclass(frozen=True)
class TableSpec:
    dataset: str
    staging_table: str
    catalog_table: str
    columns: tuple[str, ...]
    primary_key: tuple[str, ...]


TABLE_SPECS = (
    TableSpec(
        "domains",
        "domain",
        "domain",
        ("domain_id", "name", "rule_version", "definition"),
        ("domain_id",),
    ),
    TableSpec(
        "patent-domain-evaluations",
        "patent_domain_evaluation",
        "patent_domain_evaluation",
        (
            "evaluation_id",
            "patent_id",
            "domain_id",
            "patent_title",
            "patent_date",
            "matched_cpcs",
            "matched_exact_cpc",
            "matched_broad_cpc",
            "matched_strong_title",
            "matched_general_title",
            "matched_strong_keywords",
            "matched_general_keywords",
            "matched_exclusion_keywords",
            "cpc_score",
            "title_score",
            "total_score",
            "decision",
            "decision_reason",
            "rule_version",
        ),
        ("evaluation_id",),
    ),
    TableSpec(
        "patents",
        "patent",
        "patent",
        (
            "patent_id",
            "patent_type",
            "patent_date",
            "grant_year",
            "patent_title",
            "wipo_kind",
            "num_claims",
            "withdrawn",
            "filename",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("patent_id",),
    ),
    TableSpec(
        "patent-classifications",
        "patent_classification",
        "patent_classification",
        (
            "classification_id",
            "patent_id",
            "cpc_sequence",
            "cpc_version_indicator",
            "cpc_section",
            "cpc_class",
            "cpc_subclass",
            "cpc_group",
            "cpc_type",
            "cpc_action_date",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("classification_id",),
    ),
    TableSpec(
        "patent-parties",
        "patent_party",
        "patent_party",
        (
            "patent_party_id",
            "patent_id",
            "party_role",
            "party_name",
            "party_name_normalized",
            "country",
            "city",
            "region",
            "party_sequence",
            "is_individual",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("patent_party_id",),
    ),
    TableSpec(
        "company-candidates",
        "company_candidate",
        "company_candidate",
        (
            "candidate_id",
            "representative_name",
            "name_normalized",
            "country",
            "patent_count",
            "party_row_count",
            "raw_name_variant_count",
            "first_patent_id",
        ),
        ("candidate_id",),
    ),
    TableSpec(
        "companies",
        "company_entity",
        "company_entity",
        (
            "company_id",
            "preferred_name",
            "country",
            "legal_name",
            "provider",
            "entity_status",
            "in_patent_scope",
            "relationship_endpoint",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("company_id",),
    ),
    TableSpec(
        "entity-matches",
        "entity_match",
        "entity_match",
        (
            "entity_match_id",
            "candidate_id",
            "suggested_company_id",
            "provider",
            "provider_identifier",
            "suggested_name",
            "candidate_country",
            "suggested_country",
            "match_method",
            "similarity_score",
            "suggestion_rank",
            "decision",
            "decision_reason",
            "is_accepted",
            "reviewer",
            "reviewer_note",
            "rule_version",
        ),
        ("entity_match_id",),
    ),
    TableSpec(
        "company-aliases",
        "company_alias",
        "company_alias",
        (
            "alias_id",
            "company_id",
            "alias_name",
            "alias_normalized",
            "alias_type",
            "source_provider",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("alias_id",),
    ),
    TableSpec(
        "external-identifiers",
        "external_identifier",
        "external_identifier",
        (
            "external_identifier_id",
            "company_id",
            "identifier_type",
            "identifier_value",
            "provider",
            "metadata",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("external_identifier_id",),
    ),
    TableSpec(
        "company-relations",
        "company_relation",
        "company_relation",
        (
            "company_relation_id",
            "start_company_id",
            "end_company_id",
            "relationship_type",
            "relationship_status",
            "period_start_date",
            "period_end_date",
            "period_type",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("company_relation_id",),
    ),
    TableSpec(
        "patent-domain-matches",
        "patent_domain_match",
        "patent_domain_match",
        (
            "domain_match_id",
            "patent_id",
            "domain_id",
            "total_score",
            "matched_cpcs",
            "matched_strong_keywords",
            "matched_general_keywords",
            "rule_version",
            "evaluation_id",
        ),
        ("domain_match_id",),
    ),
    TableSpec(
        "company-patent-relations",
        "company_patent_relation",
        "company_patent_relation",
        (
            "company_patent_relation_id",
            "company_id",
            "patent_id",
            "patent_party_id",
            "candidate_id",
            "match_method",
            "entity_match_decision",
        ),
        ("company_patent_relation_id",),
    ),
    TableSpec(
        "entity-review-decisions",
        "entity_review_decision",
        "entity_review_decision",
        (
            "candidate_id",
            "decision",
            "organization_type",
            "selected_company_id",
            "review_method",
            "reviewed_at",
            "evidence_ids",
            "reviewer",
            "reviewer_note",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("candidate_id",),
    ),
    TableSpec(
        "entity-evidence",
        "entity_evidence",
        "entity_evidence",
        (
            "evidence_id",
            "candidate_id",
            "publisher",
            "source_type",
            "source_url",
            "observed_at",
            "legal_name",
            "country",
            "identifier_type",
            "identifier_value",
            "preserved",
            "content_sha256",
            "source_release",
            "source_path",
            "source_sha256",
            "source_row_number",
        ),
        ("evidence_id",),
    ),
)

REVIEW_SPEC = TableSpec(
    "entity-review",
    "entity_review",
    "entity_review",
    (
        "candidate_id",
        "assignee_name",
        "name_normalized",
        "country",
        "patent_count",
        "party_row_count",
        "status",
        "best_match_method",
        "best_confidence",
        "best_candidate_company_id",
        "best_candidate_name",
        "suggestions_json",
        "decision",
        "selected_company_id",
        "reviewer",
        "reviewer_note",
    ),
    ("release_id", "candidate_id"),
)

ALL_SPECS = (*TABLE_SPECS, REVIEW_SPEC)
SPEC_BY_DATASET = {spec.dataset: spec for spec in ALL_SPECS}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_db_config(path: Path) -> dict[str, str | int]:
    """Read Chinese label, .env-style, JSON, or PostgreSQL URL config."""
    if not path.is_file():
        raise CatalogError(f"Database config does not exist: {path}")
    text = path.read_text(encoding="utf-8-sig").strip()
    if not text:
        raise CatalogError("Database config is empty")
    if text.startswith("postgres://") or text.startswith("postgresql://"):
        return {"conninfo": text}
    if text.startswith("{"):
        raw = json.loads(text)
        values = {str(key).lower(): value for key, value in raw.items()}
    else:
        values: dict[str, str] = {}
        labels = {
            "主机": "host",
            "端口": "port",
            "数据库": "dbname",
            "用户名": "user",
            "用户": "user",
            "密码": "password",
            "host": "host",
            "port": "port",
            "database": "dbname",
            "dbname": "dbname",
            "username": "user",
            "user": "user",
            "password": "password",
        }
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            separator = "：" if "：" in line else "=" if "=" in line else ":"
            if separator not in line:
                raise CatalogError("Database config contains an unsupported line")
            label, value = line.split(separator, 1)
            key = labels.get(label.strip().lower())
            if key:
                values[key] = value.strip().strip('"').strip("'")
    aliases = {
        "hostname": "host",
        "database": "dbname",
        "username": "user",
    }
    normalized = {aliases.get(key, key): value for key, value in values.items()}
    required = {"host", "port", "dbname", "user", "password"}
    missing = sorted(required - normalized.keys())
    if missing:
        raise CatalogError(f"Database config is missing: {', '.join(missing)}")
    try:
        normalized["port"] = int(normalized["port"])
    except (TypeError, ValueError) as error:
        raise CatalogError("Database port must be an integer") from error
    return normalized


def _connect(config_path: Path) -> psycopg.Connection[Any]:
    config = read_db_config(config_path)
    if "conninfo" in config:
        return psycopg.connect(str(config["conninfo"]), row_factory=dict_row)
    return psycopg.connect(**config, row_factory=dict_row)


def migration_path() -> Path:
    return Path(__file__).resolve().parents[3] / "migrations" / "001_catalog.sql"


def migration_paths() -> list[Path]:
    root = Path(__file__).resolve().parents[3] / "migrations"
    return sorted(root.glob("[0-9][0-9][0-9]_*.sql"))


def migrate_database(config_path: Path) -> None:
    migrations = migration_paths()
    if not migrations:
        raise CatalogError("No PostgreSQL migrations were found")
    with _connect(config_path) as connection:
        for migration in migrations:
            connection.execute(migration.read_text(encoding="utf-8"))
            print(f"Applied PostgreSQL migration: {migration.stem}")


def _copy_rows(
    connection: psycopg.Connection[Any],
    spec: TableSpec,
    job_id: uuid.UUID,
    rows: Iterable[tuple[Any, ...]],
) -> int:
    column_names = ("import_job_id", *spec.columns)
    statement = sql.SQL("COPY staging.{} ({}) FROM STDIN").format(
        sql.Identifier(spec.staging_table),
        sql.SQL(", ").join(map(sql.Identifier, column_names)),
    )
    count = 0
    with connection.cursor().copy(statement) as copy:
        for row in rows:
            copy.write_row((job_id, *row))
            count += 1
    return count


def _duckdb_rows(path: Path, file_format: str) -> Iterable[tuple[Any, ...]]:
    connection = duckdb.connect(":memory:")
    try:
        if file_format == "parquet":
            cursor = connection.execute("SELECT * FROM read_parquet(?)", [str(path)])
        elif file_format == "csv":
            cursor = connection.execute(
                "SELECT * FROM read_csv_auto(?, header = true)", [str(path)]
            )
        else:
            raise CatalogError(f"Unsupported DuckDB input format: {file_format}")
        while rows := cursor.fetchmany(10_000):
            yield from rows
    finally:
        connection.close()


def _domain_rows(path: Path) -> Iterable[tuple[Any, ...]]:
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            value = json.loads(line)
            yield (
                value["domainId"],
                value["name"],
                value["ruleVersion"],
                json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            )


def _review_rows(path: Path) -> Iterable[tuple[Any, ...]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        for value in reader:
            yield (
                value["candidate_id"],
                value["assignee_name"],
                value["name_normalized"],
                value["country"] or None,
                int(value["patent_count"]),
                int(value["party_row_count"]),
                value["status"],
                value["best_match_method"] or None,
                float(value["best_confidence"])
                if value["best_confidence"]
                else None,
                value["best_candidate_company_id"] or None,
                value["best_candidate_name"] or None,
                value["suggestions_json"],
                value["decision"] or None,
                value["selected_company_id"] or None,
                value["reviewer"] or None,
                value["reviewer_note"] or None,
            )


def _manifest_files(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    files = {entry["dataset"]: entry for entry in manifest["files"]}
    missing = sorted(set(SPEC_BY_DATASET) - files.keys())
    if missing:
        raise CatalogError(f"Silver manifest is missing datasets: {', '.join(missing)}")
    return files


def _register_release(
    connection: psycopg.Connection[Any],
    manifest_path: Path,
    manifest: dict[str, Any],
    manifest_sha256: str,
) -> None:
    existing = connection.execute(
        "SELECT manifest_sha256 FROM catalog.dataset_release WHERE release_id = %s",
        (manifest["release"],),
    ).fetchone()
    if existing and existing["manifest_sha256"].strip() != manifest_sha256:
        raise CatalogError(
            f"Release {manifest['release']} already exists with a different manifest"
        )
    connection.execute(
        """
        INSERT INTO catalog.dataset_release (
            release_id, dataset, layer, release_status, source_status, publishable,
            generated_at, bronze_release, bronze_manifest, rules, review_file,
            period_from_year, period_to_year, unavailable_source_fields,
            manifest_path, manifest_sha256, file_count, total_rows,
            total_size_bytes, manifest
        ) VALUES (
            %(release)s, %(dataset)s, %(layer)s, 'registered', %(status)s,
            %(publishable)s, %(generated_at)s, %(bronze_release)s,
            %(bronze_manifest)s::jsonb, %(rules)s::jsonb, %(review_file)s::jsonb,
            %(from_year)s, %(to_year)s, %(unavailable)s::jsonb,
            %(manifest_path)s, %(manifest_sha256)s, %(file_count)s,
            %(total_rows)s, %(total_size_bytes)s, %(manifest)s::jsonb
        )
        ON CONFLICT (release_id) DO NOTHING
        """,
        {
            "release": manifest["release"],
            "dataset": manifest["dataset"],
            "layer": manifest["layer"],
            "status": manifest["status"],
            "publishable": manifest["publishable"],
            "generated_at": manifest["generatedAt"],
            "bronze_release": manifest.get("bronzeRelease"),
            "bronze_manifest": json.dumps(manifest["bronzeManifest"]),
            "rules": json.dumps(manifest["rules"]),
            "review_file": json.dumps(manifest.get("reviewFile")),
            "from_year": manifest["period"]["fromYear"],
            "to_year": manifest["period"]["toYear"],
            "unavailable": json.dumps(manifest["unavailableSourceFields"]),
            "manifest_path": str(manifest_path),
            "manifest_sha256": manifest_sha256,
            "file_count": manifest["fileCount"],
            "total_rows": manifest["totalRows"],
            "total_size_bytes": manifest["totalSizeBytes"],
            "manifest": json.dumps(manifest),
        },
    )
    for entry in manifest["files"]:
        connection.execute(
            """
            INSERT INTO catalog.source_file (
                release_id, dataset, relative_path, file_format, row_count,
                column_count, schema_json, size_bytes, sha256
            ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
            ON CONFLICT (release_id, relative_path) DO NOTHING
            """,
            (
                manifest["release"],
                entry["dataset"],
                entry["path"],
                entry["format"],
                entry["rowCount"],
                entry["columnCount"],
                json.dumps(entry["schema"]),
                entry["sizeBytes"],
                entry["sha256"],
            ),
        )


def _upsert_table(
    connection: psycopg.Connection[Any],
    spec: TableSpec,
    job_id: uuid.UUID,
    release: str,
) -> None:
    columns = list(spec.columns)
    tracked_columns = [*columns, "first_seen_release", "last_seen_release"]
    update_columns = [column for column in columns if column not in spec.primary_key]
    assignments = [
        sql.SQL("{} = EXCLUDED.{}").format(
            sql.Identifier(column), sql.Identifier(column)
        )
        for column in update_columns
    ]
    assignments.append(
        sql.SQL("last_seen_release = EXCLUDED.last_seen_release")
    )
    statement = sql.SQL(
        """
        INSERT INTO catalog.{} ({})
        SELECT {}, %s, %s
        FROM staging.{}
        WHERE import_job_id = %s
        ON CONFLICT ({}) DO UPDATE SET {}
        """
    ).format(
        sql.Identifier(spec.catalog_table),
        sql.SQL(", ").join(map(sql.Identifier, tracked_columns)),
        sql.SQL(", ").join(map(sql.Identifier, columns)),
        sql.Identifier(spec.staging_table),
        sql.SQL(", ").join(map(sql.Identifier, spec.primary_key)),
        sql.SQL(", ").join(assignments),
    )
    connection.execute(statement, (release, release, job_id))


def _publish_review(
    connection: psycopg.Connection[Any], job_id: uuid.UUID, release: str
) -> None:
    columns = list(REVIEW_SPEC.columns)
    statement = sql.SQL(
        """
        INSERT INTO catalog.entity_review (release_id, {})
        SELECT %s, {} FROM staging.entity_review WHERE import_job_id = %s
        ON CONFLICT (release_id, candidate_id) DO UPDATE SET {}
        """
    ).format(
        sql.SQL(", ").join(map(sql.Identifier, columns)),
        sql.SQL(", ").join(map(sql.Identifier, columns)),
        sql.SQL(", ").join(
            sql.SQL("{} = EXCLUDED.{}").format(
                sql.Identifier(column), sql.Identifier(column)
            )
            for column in columns
            if column != "candidate_id"
        ),
    )
    connection.execute(statement, (release, job_id))


def _validate_staging(
    connection: psycopg.Connection[Any],
    job_id: uuid.UUID,
    expected: dict[str, int],
) -> None:
    for spec in ALL_SPECS:
        actual = connection.execute(
            sql.SQL("SELECT count(*) AS count FROM staging.{} WHERE import_job_id = %s")
            .format(sql.Identifier(spec.staging_table)),
            (job_id,),
        ).fetchone()["count"]
        if actual != expected[spec.dataset]:
            raise CatalogError(
                f"Staging row mismatch for {spec.dataset}: "
                f"expected {expected[spec.dataset]}, got {actual}"
            )
        key_columns = sql.SQL(", ").join(
            map(sql.Identifier, spec.primary_key[-1:])
        )
        duplicates = connection.execute(
            sql.SQL(
                "SELECT count(*) AS count FROM (SELECT {} FROM staging.{} "
                "WHERE import_job_id = %s GROUP BY {} HAVING count(*) > 1) d"
            ).format(
                key_columns,
                sql.Identifier(spec.staging_table),
                key_columns,
            ),
            (job_id,),
        ).fetchone()["count"]
        if duplicates:
            raise CatalogError(f"Duplicate keys in staging dataset {spec.dataset}")
    orphan_checks = {
        "patent classifications": """
            SELECT count(*) FROM staging.patent_classification c
            LEFT JOIN staging.patent p ON p.import_job_id = c.import_job_id
                AND p.patent_id = c.patent_id
            WHERE c.import_job_id = %s AND p.patent_id IS NULL
        """,
        "patent parties": """
            SELECT count(*) FROM staging.patent_party x
            LEFT JOIN staging.patent p ON p.import_job_id = x.import_job_id
                AND p.patent_id = x.patent_id
            WHERE x.import_job_id = %s AND p.patent_id IS NULL
        """,
        "domain matches": """
            SELECT count(*) FROM staging.patent_domain_match m
            LEFT JOIN staging.patent p ON p.import_job_id = m.import_job_id
                AND p.patent_id = m.patent_id
            LEFT JOIN staging.domain d ON d.import_job_id = m.import_job_id
                AND d.domain_id = m.domain_id
            LEFT JOIN staging.patent_domain_evaluation e
                ON e.import_job_id = m.import_job_id
                AND e.evaluation_id = m.evaluation_id
            WHERE m.import_job_id = %s AND (
                p.patent_id IS NULL OR d.domain_id IS NULL OR e.evaluation_id IS NULL
            )
        """,
        "company aliases": """
            SELECT count(*) FROM staging.company_alias a
            LEFT JOIN staging.company_entity c ON c.import_job_id = a.import_job_id
                AND c.company_id = a.company_id
            WHERE a.import_job_id = %s AND c.company_id IS NULL
        """,
        "company relations": """
            SELECT count(*) FROM staging.company_relation r
            LEFT JOIN staging.company_entity s ON s.import_job_id = r.import_job_id
                AND s.company_id = r.start_company_id
            LEFT JOIN staging.company_entity e ON e.import_job_id = r.import_job_id
                AND e.company_id = r.end_company_id
            WHERE r.import_job_id = %s
                AND (s.company_id IS NULL OR e.company_id IS NULL)
        """,
        "company patent relations": """
            SELECT count(*) FROM staging.company_patent_relation r
            LEFT JOIN staging.company_entity c ON c.import_job_id = r.import_job_id
                AND c.company_id = r.company_id
            LEFT JOIN staging.patent p ON p.import_job_id = r.import_job_id
                AND p.patent_id = r.patent_id
            LEFT JOIN staging.patent_party pp ON pp.import_job_id = r.import_job_id
                AND pp.patent_party_id = r.patent_party_id
            LEFT JOIN staging.company_candidate cc
                ON cc.import_job_id = r.import_job_id
                AND cc.candidate_id = r.candidate_id
            WHERE r.import_job_id = %s AND (
                c.company_id IS NULL OR p.patent_id IS NULL
                OR pp.patent_party_id IS NULL OR cc.candidate_id IS NULL
            )
        """,
        "accepted entity matches": """
            SELECT count(*) FROM staging.entity_match m
            LEFT JOIN staging.company_entity c ON c.import_job_id = m.import_job_id
                AND c.company_id = m.suggested_company_id
            WHERE m.import_job_id = %s AND m.is_accepted
                AND c.company_id IS NULL
        """,
    }
    for label, statement in orphan_checks.items():
        count = connection.execute(statement, (job_id,)).fetchone()["count"]
        if count:
            raise CatalogError(f"Staging contains {count} orphan {label}")


def _record_dataset_rows(
    connection: psycopg.Connection[Any], job_id: uuid.UUID, release: str
) -> None:
    for spec in TABLE_SPECS:
        key = spec.primary_key[0]
        connection.execute(
            sql.SQL(
                """
                INSERT INTO catalog.dataset_record (release_id, entity_type, entity_id)
                SELECT %s, %s, {} FROM staging.{} WHERE import_job_id = %s
                ON CONFLICT DO NOTHING
                """
            ).format(sql.Identifier(key), sql.Identifier(spec.staging_table)),
            (release, spec.dataset, job_id),
        )
    connection.execute(
        """
        INSERT INTO catalog.dataset_record (release_id, entity_type, entity_id)
        SELECT %s, %s, candidate_id FROM staging.entity_review
        WHERE import_job_id = %s ON CONFLICT DO NOTHING
        """,
        (release, REVIEW_SPEC.dataset, job_id),
    )


def _clear_staging(connection: psycopg.Connection[Any], job_id: uuid.UUID) -> None:
    for spec in ALL_SPECS:
        connection.execute(
            sql.SQL("DELETE FROM staging.{} WHERE import_job_id = %s").format(
                sql.Identifier(spec.staging_table)
            ),
            (job_id,),
        )


def verify_catalog_release(
    config_path: Path, release: str, manifest_path: Path | None = None
) -> dict[str, int]:
    expected: dict[str, int] | None = None
    if manifest_path:
        manifest = verify_silver(manifest_path=manifest_path.resolve())
        if manifest["release"] != release:
            raise CatalogError("Manifest release does not match --release")
        expected = {
            entry["dataset"]: entry["rowCount"] for entry in manifest["files"]
        }
    with _connect(config_path) as connection:
        release_row = connection.execute(
            """
            SELECT release_status, manifest_sha256
            FROM catalog.dataset_release WHERE release_id = %s
            """,
            (release,),
        ).fetchone()
        if not release_row:
            raise CatalogError(f"Catalog release does not exist: {release}")
        if release_row["release_status"] != "published":
            raise CatalogError(f"Catalog release is not published: {release}")
        if manifest_path and release_row["manifest_sha256"].strip() != _sha256_file(
            manifest_path
        ):
            raise CatalogError("Catalog release manifest SHA-256 does not match")
        rows = connection.execute(
            """
            SELECT entity_type, count(*) AS count
            FROM catalog.dataset_record WHERE release_id = %s
            GROUP BY entity_type ORDER BY entity_type
            """,
            (release,),
        ).fetchall()
        counts = {row["entity_type"]: row["count"] for row in rows}
        if expected and counts != expected:
            raise CatalogError(
                "Catalog release row counts differ: "
                f"expected={expected}, actual={counts}"
            )
        orphan_checks = (
            """SELECT count(*) FROM catalog.patent_classification c
                LEFT JOIN catalog.patent p USING (patent_id)
                WHERE p.patent_id IS NULL""",
            """SELECT count(*) FROM catalog.patent_party x
                LEFT JOIN catalog.patent p USING (patent_id)
                WHERE p.patent_id IS NULL""",
            """SELECT count(*) FROM catalog.patent_domain_match m
                LEFT JOIN catalog.patent p USING (patent_id)
                LEFT JOIN catalog.domain d USING (domain_id)
                WHERE p.patent_id IS NULL OR d.domain_id IS NULL""",
            """SELECT count(*) FROM catalog.company_patent_relation r
                LEFT JOIN catalog.company_entity c USING (company_id)
                LEFT JOIN catalog.patent p USING (patent_id)
                WHERE c.company_id IS NULL OR p.patent_id IS NULL""",
        )
        for statement in orphan_checks:
            if connection.execute(statement).fetchone()["count"]:
                raise CatalogError("Catalog contains orphan relationships")
    print(f"Verified PostgreSQL catalog release: {release}")
    return counts


def import_release(config_path: Path, manifest_path: Path) -> dict[str, int]:
    manifest_path = manifest_path.resolve()
    try:
        manifest = verify_silver(
            manifest_path=manifest_path,
            on_progress=lambda message: print(message),
        )
    except SilverError as error:
        raise CatalogError(str(error)) from error
    if manifest.get("status") != "passed" or not manifest.get("publishable"):
        raise CatalogError("Only passed, publishable Silver releases can be imported")
    _manifest_files(manifest)
    manifest_sha256 = _sha256_file(manifest_path)
    release = manifest["release"]
    migrate_database(config_path)
    with _connect(config_path) as connection:
        existing = connection.execute(
            """
            SELECT release_status, manifest_sha256
            FROM catalog.dataset_release WHERE release_id = %s
            """,
            (release,),
        ).fetchone()
    if existing and existing["release_status"] == "published":
        if existing["manifest_sha256"].strip() != manifest_sha256:
            raise CatalogError(
                f"Published release {release} has a different manifest SHA-256"
            )
        print(f"Release already published; verifying without rewriting: {release}")
        return verify_catalog_release(config_path, release, manifest_path)

    job_id = uuid.uuid4()
    with _connect(config_path) as connection:
        _register_release(connection, manifest_path, manifest, manifest_sha256)
        connection.execute(
            """
            INSERT INTO catalog.import_job (import_job_id, release_id, status)
            VALUES (%s, %s, 'loading')
            """,
            (job_id, release),
        )
    counts: dict[str, int] = {}
    try:
        with _connect(config_path) as connection:
            for index, entry in enumerate(manifest["files"], start=1):
                spec = SPEC_BY_DATASET[entry["dataset"]]
                path = manifest_path.parent / entry["path"]
                if entry["format"] == "jsonl":
                    rows = _domain_rows(path)
                elif entry["format"] == "csv":
                    rows = _review_rows(path)
                else:
                    rows = _duckdb_rows(path, entry["format"])
                count = _copy_rows(connection, spec, job_id, rows)
                counts[entry["dataset"]] = count
                print(
                    f"Loaded staging [{index}/{len(manifest['files'])}] "
                    f"{entry['dataset']}: {count:,} rows"
                )
            expected = {
                entry["dataset"]: entry["rowCount"] for entry in manifest["files"]
            }
            _validate_staging(connection, job_id, expected)
            for spec in TABLE_SPECS:
                _upsert_table(connection, spec, job_id, release)
            _publish_review(connection, job_id, release)
            _record_dataset_rows(connection, job_id, release)
            _clear_staging(connection, job_id)
            connection.execute(
                """
                UPDATE catalog.dataset_release
                SET release_status = 'published', published_at = now()
                WHERE release_id = %s
                """,
                (release,),
            )
            connection.execute(
                """
                UPDATE catalog.import_job
                SET status = 'published', completed_at = now(),
                    imported_rows = %s, table_counts = %s::jsonb
                WHERE import_job_id = %s
                """,
                (sum(counts.values()), json.dumps(counts), job_id),
            )
    except Exception as error:
        with _connect(config_path) as connection:
            connection.execute(
                """
                UPDATE catalog.import_job
                SET status = 'failed', completed_at = now(), error_message = %s
                WHERE import_job_id = %s
                """,
                (str(error)[:4000], job_id),
            )
        raise
    print(f"Published PostgreSQL catalog release: {release}")
    return verify_catalog_release(config_path, release, manifest_path)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("migrate", "import", "verify"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument(
            "--db-config", type=Path, required=True, help="Path to db.txt or .env"
        )
        if command == "import":
            command_parser.add_argument("--manifest", type=Path, required=True)
        if command == "verify":
            command_parser.add_argument("--release", required=True)
            command_parser.add_argument("--manifest", type=Path)
    return parser


def main() -> None:
    args = _parser().parse_args()
    try:
        if args.command == "migrate":
            migrate_database(args.db_config)
        elif args.command == "import":
            import_release(args.db_config, args.manifest)
        else:
            verify_catalog_release(args.db_config, args.release, args.manifest)
    except (CatalogError, psycopg.Error) as error:
        raise SystemExit(f"Catalog error: {error}") from error


if __name__ == "__main__":
    main()
