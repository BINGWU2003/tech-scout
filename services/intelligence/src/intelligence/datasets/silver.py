"""Build and verify immutable AI-domain Silver Parquet releases."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import yaml

from intelligence.datasets.bronze import BronzeError, verify_bronze
from intelligence.datasets.entity_review import (
    EntityReviewError,
    verify_entity_review,
)

SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
VERSION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
ProgressCallback = Callable[[str], None]

BRONZE_DATASETS = {
    "uspto-pvannual",
    "uspto-patent",
    "uspto-cpc-at-issue",
    "gleif-entities",
    "gleif-relationships",
    "sec-companies",
}

PARQUET_OUTPUTS = (
    ("patent-domain-evaluations", "patent_domain_evaluations.parquet"),
    ("patents", "patents.parquet"),
    ("patent-classifications", "patent_classifications.parquet"),
    ("patent-parties", "patent_parties.parquet"),
    ("patent-domain-matches", "patent_domain_matches.parquet"),
    ("company-candidates", "company_candidates.parquet"),
    ("entity-matches", "entity_matches.parquet"),
    ("companies", "companies.parquet"),
    ("company-aliases", "company_aliases.parquet"),
    ("external-identifiers", "external_identifiers.parquet"),
    ("company-relations", "company_relations.parquet"),
    ("company-patent-relations", "company_patent_relations.parquet"),
    ("entity-review-decisions", "entity_review_decisions.parquet"),
    ("entity-evidence", "entity_evidence.parquet"),
)


class SilverError(RuntimeError):
    """Raised when a Silver build or verification invariant fails."""


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SilverError(f"Unable to read JSON file {path}: {error}") from error
    if not isinstance(value, dict):
        raise SilverError(f"JSON root must be an object: {path}")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _read_rules(path: Path) -> dict[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        raise SilverError(f"Unable to read rules file {path}: {error}") from error
    if not isinstance(value, dict):
        raise SilverError(f"Rules root must be an object: {path}")
    _validate_rules(value)
    return value


def _validate_rules(rules: dict[str, Any]) -> None:
    required = {
        "schemaVersion",
        "ruleVersion",
        "releaseName",
        "period",
        "scoring",
        "normalization",
        "matching",
        "duckdb",
        "qualityBaseline",
        "domains",
    }
    missing = required.difference(rules)
    if missing:
        raise SilverError(f"Rules are missing fields: {', '.join(sorted(missing))}")
    domains = rules["domains"]
    if not isinstance(domains, list) or not domains:
        raise SilverError("Rules must define at least one domain")
    domain_ids: set[str] = set()
    for domain in domains:
        domain_id = domain.get("id")
        if not isinstance(domain_id, str) or not domain_id:
            raise SilverError("Every domain must have a non-empty id")
        if domain_id in domain_ids:
            raise SilverError(f"Duplicate domain id: {domain_id}")
        domain_ids.add(domain_id)
        for field in (
            "exactCpcPrefixes",
            "broadCpcPrefixes",
            "generalTitleTerms",
            "strongTitleTerms",
            "exclusionTitleTerms",
        ):
            if not isinstance(domain.get(field), list):
                raise SilverError(f"{domain_id}.{field} must be a list")
        if not domain["exactCpcPrefixes"] and not domain["broadCpcPrefixes"]:
            raise SilverError(f"{domain_id} must define a CPC prefix")
    expected_domains = set(rules["qualityBaseline"]["domainCounts"])
    if expected_domains != domain_ids:
        raise SilverError("qualityBaseline.domainCounts must cover every domain")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _sql_literal(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _sql_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _normalize_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/").removeprefix("./")
    path = Path(normalized)
    if (
        not normalized
        or normalized == ".."
        or normalized.startswith("../")
        or path.is_absolute()
    ):
        raise SilverError(f"Path must stay inside its release root: {value}")
    return normalized


def _parquet_schema(
    connection: duckdb.DuckDBPyConnection, path: Path
) -> list[dict[str, str]]:
    rows = connection.execute(
        f"DESCRIBE SELECT * FROM read_parquet({_sql_literal(path.resolve())})"
    ).fetchall()
    return [{"name": row[0], "type": row[1]} for row in rows]


def _bronze_paths(
    bronze_manifest: dict[str, Any], bronze_root: Path
) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for file in bronze_manifest.get("files", []):
        dataset = file.get("dataset")
        if dataset in BRONZE_DATASETS:
            result[dataset] = bronze_root / _normalize_relative_path(file["path"])
    missing = BRONZE_DATASETS.difference(result)
    if missing:
        raise SilverError(
            f"Bronze manifest is missing datasets: {', '.join(sorted(missing))}"
        )
    return result


def _configure_duckdb(
    connection: duckdb.DuckDBPyConnection,
    rules: dict[str, Any],
    temporary_directory: Path,
) -> None:
    settings = rules["duckdb"]
    temporary_directory.mkdir(parents=True)
    connection.execute(f"SET memory_limit = {_sql_literal(settings['memoryLimit'])}")
    connection.execute(f"SET threads = {int(settings['threads'])}")
    connection.execute(
        f"SET temp_directory = {_sql_literal(temporary_directory.resolve())}"
    )
    connection.execute("SET preserve_insertion_order = false")
    connection.execute("PRAGMA disable_progress_bar")


def _prefix_condition(expression: str, prefixes: Iterable[str]) -> str:
    conditions = [
        f"starts_with({expression}, {_sql_literal(prefix.upper().replace(' ', ''))})"
        for prefix in prefixes
    ]
    return "(" + " OR ".join(conditions) + ")" if conditions else "FALSE"


def _contains_condition(expression: str, terms: Iterable[str]) -> str:
    conditions = [
        f"contains({expression}, {_sql_literal(term.casefold())})" for term in terms
    ]
    return "(" + " OR ".join(conditions) + ")" if conditions else "FALSE"


def _matched_terms_json(expression: str, terms: Iterable[str]) -> str:
    values = [
        f"CASE WHEN contains({expression}, {_sql_literal(term.casefold())}) "
        f"THEN {_sql_literal(term)} END"
        for term in terms
    ]
    if not values:
        return "'[]'"
    return f"to_json(list_filter([{', '.join(values)}], x -> x IS NOT NULL))"


def _normalized_name_expr(expression: str, suffixes: Iterable[str]) -> str:
    cleaned = (
        "trim(regexp_replace(regexp_replace(nfc_normalize(lower(coalesce("
        f"{expression}, ''))), '[^\\p{{L}}\\p{{N}}]+', ' ', 'g'), "
        "'\\s+', ' ', 'g'))"
    )
    suffix_pattern = "|".join(re.escape(suffix.casefold()) for suffix in suffixes)
    return (
        "trim(regexp_replace("
        f"{cleaned}, '(\\s+({suffix_pattern}))+$', '', 'g'))"
    )


def _country_expr(expression: str) -> str:
    return (
        f"CASE WHEN trim(coalesce({expression}, '')) = '' THEN NULL "
        f"ELSE upper(trim({expression})) END"
    )


def _create_bronze_views(
    connection: duckdb.DuckDBPyConnection, paths: dict[str, Path]
) -> None:
    views = {
        "bronze_annual": paths["uspto-pvannual"],
        "bronze_patents": paths["uspto-patent"],
        "bronze_cpc": paths["uspto-cpc-at-issue"],
        "bronze_gleif_entities": paths["gleif-entities"],
        "bronze_gleif_relationships": paths["gleif-relationships"],
        "bronze_sec_companies": paths["sec-companies"],
    }
    for view, path in views.items():
        connection.execute(
            f"CREATE TEMP VIEW {view} AS SELECT * FROM "
            f"read_parquet({_sql_literal(path.resolve())})"
        )


def _create_domain_evaluations(
    connection: duckdb.DuckDBPyConnection, rules: dict[str, Any]
) -> None:
    period = rules["period"]
    scoring = rules["scoring"]
    connection.execute(
        f"""
        CREATE TEMP TABLE eligible_patents_temp AS
        SELECT patent_id,
               patent_type,
               try_cast(patent_date AS DATE) AS patent_date,
               patent_title,
               lower(coalesce(patent_title, '')) AS title_normalized,
               wipo_kind,
               try_cast(num_claims AS INTEGER) AS num_claims,
               try_cast(withdrawn AS BOOLEAN) AS withdrawn,
               filename,
               _source_release,
               _source_path,
               _source_sha256,
               _source_row_number
        FROM bronze_patents
        WHERE year(try_cast(patent_date AS DATE)) BETWEEN
              {int(period['fromYear'])} AND {int(period['toYear'])}
        """
    )
    evaluation_tables: list[str] = []
    for index, domain in enumerate(rules["domains"]):
        exact = _prefix_condition("cpc_normalized", domain["exactCpcPrefixes"])
        broad = _prefix_condition("cpc_normalized", domain["broadCpcPrefixes"])
        candidate = f"({exact} OR {broad})"
        strong = _contains_condition(
            "p.title_normalized", domain["strongTitleTerms"]
        )
        general = _contains_condition(
            "p.title_normalized", domain["generalTitleTerms"]
        )
        exclusions = _contains_condition(
            "p.title_normalized", domain["exclusionTitleTerms"]
        )
        strong_json = _matched_terms_json(
            "p.title_normalized", domain["strongTitleTerms"]
        )
        general_json = _matched_terms_json(
            "p.title_normalized", domain["generalTitleTerms"]
        )
        exclusion_json = _matched_terms_json(
            "p.title_normalized", domain["exclusionTitleTerms"]
        )
        table = f"domain_evaluation_{index}_temp"
        evaluation_tables.append(table)
        connection.execute(
            f"""
            CREATE TEMP TABLE {table} AS
            WITH normalized_cpc AS (
              SELECT patent_id,
                     upper(replace(coalesce(cpc_group, ''), ' ', ''))
                       AS cpc_normalized,
                     cpc_group
              FROM bronze_cpc
              WHERE patent_id IN (SELECT patent_id FROM eligible_patents_temp)
            ), cpc_evidence AS (
              SELECT patent_id,
                     to_json(list_sort(list_distinct(list(cpc_group))))
                       AS matched_cpcs,
                     bool_or({exact}) AS matched_exact_cpc,
                     bool_or({broad}) AS matched_broad_cpc
              FROM normalized_cpc
              WHERE {candidate}
              GROUP BY patent_id
            ), scored AS (
              SELECT p.patent_id,
                     {_sql_literal(domain['id'])}::VARCHAR AS domain_id,
                     p.patent_title,
                     p.patent_date,
                     c.matched_cpcs,
                     c.matched_exact_cpc,
                     c.matched_broad_cpc,
                     ({strong}) AS matched_strong_title,
                     ({general}) AS matched_general_title,
                     {strong_json} AS matched_strong_keywords,
                     {general_json} AS matched_general_keywords,
                     {exclusion_json} AS matched_exclusion_keywords,
                     CASE WHEN c.matched_exact_cpc
                          THEN {int(scoring['exactCpc'])}
                          WHEN c.matched_broad_cpc
                          THEN {int(scoring['broadCpc'])}
                          ELSE 0 END AS cpc_score,
                     CASE WHEN {strong} THEN {int(scoring['strongTitle'])}
                          WHEN {general} THEN {int(scoring['generalTitle'])}
                          ELSE 0 END AS title_score,
                     ({exclusions}) AS has_exclusion
              FROM eligible_patents_temp p
              JOIN cpc_evidence c USING (patent_id)
            )
            SELECT 'pde_' || substr(sha256(domain_id || '|' || patent_id), 1, 32)
                     AS evaluation_id,
                   patent_id,
                   domain_id,
                   patent_title,
                   patent_date,
                   matched_cpcs,
                   matched_exact_cpc,
                   matched_broad_cpc,
                   matched_strong_title,
                   matched_general_title,
                   matched_strong_keywords,
                   matched_general_keywords,
                   matched_exclusion_keywords,
                   cpc_score,
                   title_score,
                   cpc_score + title_score AS total_score,
                   CASE WHEN has_exclusion THEN 'excluded'
                        WHEN cpc_score + title_score >= {int(scoring['threshold'])}
                          THEN 'included'
                        ELSE 'excluded' END AS decision,
                   CASE WHEN has_exclusion THEN 'title_exclusion_term'
                        WHEN cpc_score + title_score >= {int(scoring['threshold'])}
                          THEN 'score_threshold_met'
                        ELSE 'score_below_threshold' END AS decision_reason,
                   {_sql_literal(rules['ruleVersion'])}::VARCHAR AS rule_version
            FROM scored
            """
        )
    connection.execute(
        "CREATE TEMP TABLE patent_domain_evaluations_temp AS "
        + " UNION ALL ".join(f"SELECT * FROM {table}" for table in evaluation_tables)
    )
    connection.execute(
        """
        CREATE TEMP TABLE patent_domain_matches_temp AS
        SELECT 'pdm_' || substr(sha256(domain_id || '|' || patent_id), 1, 32)
                 AS domain_match_id,
               patent_id,
               domain_id,
               total_score,
               matched_cpcs,
               matched_strong_keywords,
               matched_general_keywords,
               rule_version,
               evaluation_id
        FROM patent_domain_evaluations_temp
        WHERE decision = 'included'
        """
    )


def _create_patent_tables(
    connection: duckdb.DuckDBPyConnection, rules: dict[str, Any]
) -> None:
    suffixes = rules["normalization"]["companySuffixes"]
    normalized_assignee = _normalized_name_expr("a.assignee", suffixes)
    country = _country_expr("a.country")
    connection.execute(
        """
        CREATE TEMP TABLE patents_temp AS
        SELECT p.patent_id,
               p.patent_type,
               p.patent_date,
               year(p.patent_date)::SMALLINT AS grant_year,
               p.patent_title,
               p.wipo_kind,
               p.num_claims,
               p.withdrawn,
               p.filename,
               p._source_release AS source_release,
               p._source_path AS source_path,
               p._source_sha256 AS source_sha256,
               p._source_row_number AS source_row_number
        FROM eligible_patents_temp p
        WHERE EXISTS (
          SELECT 1 FROM patent_domain_matches_temp d WHERE d.patent_id = p.patent_id
        )
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE patent_classifications_temp AS
        SELECT 'pc_' || substr(sha256(
                 c._source_sha256 || '|' || c._source_row_number::VARCHAR
               ), 1, 32) AS classification_id,
               c.patent_id,
               try_cast(c.cpc_sequence AS INTEGER) AS cpc_sequence,
               c.cpc_version_indicator,
               c.cpc_section,
               c.cpc_class,
               c.cpc_subclass,
               c.cpc_group,
               c.cpc_type,
               try_cast(c.cpc_action_date AS DATE) AS cpc_action_date,
               c._source_release AS source_release,
               c._source_path AS source_path,
               c._source_sha256 AS source_sha256,
               c._source_row_number AS source_row_number
        FROM bronze_cpc c
        JOIN patents_temp p ON p.patent_id = c.patent_id
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE patent_parties_temp AS
        SELECT 'pp_' || substr(sha256(
                 a._source_sha256 || '|' || a._source_row_number::VARCHAR
               ), 1, 32) AS patent_party_id,
               a.patent_number AS patent_id,
               'assignee'::VARCHAR AS party_role,
               a.assignee AS party_name,
               {normalized_assignee} AS party_name_normalized,
               {country} AS country,
               nullif(trim(a.city), '') AS city,
               nullif(trim(a.state), '') AS region,
               try_cast(a.assignee_sequence AS INTEGER) AS party_sequence,
               try_cast(a.assignee_ind AS BOOLEAN) AS is_individual,
               a._source_release AS source_release,
               a._source_path AS source_path,
               a._source_sha256 AS source_sha256,
               a._source_row_number AS source_row_number
        FROM bronze_annual a
        JOIN patents_temp p ON p.patent_id = a.patent_number
        WHERE trim(coalesce(a.assignee, '')) <> ''
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE company_candidates_temp AS
        SELECT 'cc_' || substr(sha256(
                 party_name_normalized || '|' || coalesce(country, '')
               ), 1, 32) AS candidate_id,
               arg_min(party_name, lower(party_name)) AS representative_name,
               party_name_normalized AS name_normalized,
               country,
               count(DISTINCT patent_id)::BIGINT AS patent_count,
               count(*)::BIGINT AS party_row_count,
               count(DISTINCT party_name)::INTEGER AS raw_name_variant_count,
               min(patent_id) AS first_patent_id
        FROM patent_parties_temp
        WHERE party_name_normalized <> ''
        GROUP BY party_name_normalized, country
        """
    )


def _gleif_alias_columns() -> list[tuple[str, str]]:
    columns = [("Entity.LegalName", "legal_name")]
    columns.extend(
        (f"Entity.OtherEntityNames.OtherEntityName.{index}", "other_name")
        for index in range(1, 6)
    )
    columns.extend(
        (
            "Entity.TransliteratedOtherEntityNames."
            f"TransliteratedOtherEntityName.{index}",
            "transliterated_other_name",
        )
        for index in range(1, 6)
    )
    return columns


def _gleif_alias_list_sql(alias: str = "e") -> str:
    values = ", ".join(
        f"{alias}.{_sql_identifier(column)}" for column, _kind in _gleif_alias_columns()
    )
    return f"[{values}]"


def _gleif_country_sql(alias: str = "e") -> str:
    legal = f"{alias}.{_sql_identifier('Entity.LegalAddress.Country')}"
    headquarters = f"{alias}.{_sql_identifier('Entity.HeadquartersAddress.Country')}"
    return _country_expr(f"coalesce(nullif(trim({legal}), ''), {headquarters})")


def _read_reviews(path: Path | None) -> list[dict[str, Any]]:
    if path is None:
        return []
    required = {
        "candidate_id",
        "decision",
        "selected_company_id",
        "reviewer",
        "reviewer_note",
    }
    source_release: str | None = None
    try:
        if path.suffix.casefold() == ".json":
            payload = _read_json(path)
            raw_rows = payload.get("decisions")
            if not isinstance(raw_rows, list):
                raise SilverError("JSON review file must contain a decisions list")
            default_reviewer = payload.get("reviewer")
            default_reviewed_at = payload.get("confirmedAt")
            source_release = payload.get("batchId") or payload.get(
                "sourceSilverRelease"
            )
            rows_to_validate = []
            for row in raw_rows:
                if not isinstance(row, dict):
                    raise SilverError("Every JSON review decision must be an object")
                normalized_row = dict(row)
                normalized_row.setdefault("reviewer", default_reviewer)
                normalized_row.setdefault("reviewer_note", None)
                normalized_row.setdefault("reviewedAt", default_reviewed_at)
                normalized_row.setdefault("organizationType", None)
                normalized_row.setdefault("reviewMethod", None)
                normalized_row.setdefault("evidenceIds", [])
                normalized_row.setdefault("localEntity", None)
                rows_to_validate.append(normalized_row)
            start_line = 1
        else:
            with path.open("r", encoding="utf-8-sig", newline="") as source:
                reader = csv.DictReader(source)
                missing = required.difference(reader.fieldnames or [])
                if missing:
                    raise SilverError(
                        "Review file is missing columns: "
                        + ", ".join(sorted(missing))
                    )
                rows_to_validate = list(reader)
            start_line = 2

        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for line_number, row in enumerate(rows_to_validate, start=start_line):
            missing = required.difference(row)
            if missing:
                raise SilverError(
                    "Review file is missing columns: " + ", ".join(sorted(missing))
                )
            candidate_id = str(row["candidate_id"] or "").strip()
            decision = str(row["decision"] or "").strip().casefold()
            selected = str(row["selected_company_id"] or "").strip() or None
            reviewer = str(row["reviewer"] or "").strip() or None
            note = str(row["reviewer_note"] or "").strip() or None
            if not candidate_id:
                raise SilverError(f"Review line {line_number} has no candidate_id")
            if candidate_id in seen:
                raise SilverError(f"Duplicate review candidate_id: {candidate_id}")
            seen.add(candidate_id)
            if decision not in {
                "accepted",
                "rejected",
                "unmatched",
                "verified_unmatched",
                "non_company",
                "insufficient_evidence",
            }:
                raise SilverError(
                    f"Review line {line_number} has invalid decision: {decision}"
                )
            if decision == "accepted" and (not selected or not reviewer):
                raise SilverError(
                    f"Accepted review line {line_number} requires company and reviewer"
                )
            if decision != "accepted" and selected:
                raise SilverError(
                    f"Review line {line_number} selects a company without acceptance"
                )
            rows.append(
                {
                    "candidate_id": candidate_id,
                    "decision": decision,
                    "selected_company_id": selected,
                    "reviewer": reviewer,
                    "reviewer_note": note,
                    "organization_type": row.get("organizationType")
                    or ("company" if decision == "accepted" else "unknown"),
                    "review_method": row.get("reviewMethod")
                    or ("user_confirmed_legacy" if reviewer else "legacy_review"),
                    "reviewed_at": row.get("reviewedAt"),
                    "evidence_ids": row.get("evidenceIds") or [],
                    "local_entity": row.get("localEntity"),
                    "source_release": (
                        source_release if path.suffix.casefold() == ".json" else None
                    ),
                    "source_path": str(path.resolve()),
                    "source_sha256": _sha256_file(path),
                    "source_row_number": line_number,
                }
            )
    except OSError as error:
        raise SilverError(f"Unable to read review file {path}: {error}") from error
    return rows


def _read_review_evidence(
    manifest_path: Path | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    if manifest_path is None:
        return [], None
    try:
        manifest = verify_entity_review(manifest_path)
    except EntityReviewError as error:
        raise SilverError(f"Review evidence verification failed: {error}") from error
    if manifest.get("status") != "passed":
        raise SilverError("Review evidence manifest is not final")
    evidence_entries = [
        entry for entry in manifest["files"] if entry.get("path") == "evidence.jsonl"
    ]
    if len(evidence_entries) != 1:
        raise SilverError("Review evidence manifest has no unique evidence.jsonl")
    entry = evidence_entries[0]
    path = manifest_path.parent / entry["path"]
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line:
            continue
        row = json.loads(line)
        row["source_release"] = manifest["release"]
        row["source_path"] = str(path.resolve())
        row["source_sha256"] = entry["sha256"]
        row["source_row_number"] = line_number
        rows.append(row)
    return rows, manifest


def _create_review_table(
    connection: duckdb.DuckDBPyConnection,
    reviews: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
) -> None:
    connection.execute(
        """
        CREATE TEMP TABLE review_decisions_temp (
          candidate_id VARCHAR,
          review_decision VARCHAR,
          selected_company_id VARCHAR,
          reviewer VARCHAR,
          reviewer_note VARCHAR,
          organization_type VARCHAR,
          review_method VARCHAR,
          reviewed_at TIMESTAMPTZ,
          evidence_ids JSON,
          local_entity JSON,
          source_release VARCHAR,
          source_path VARCHAR,
          source_sha256 VARCHAR,
          source_row_number BIGINT
        )
        """
    )
    if reviews:
        connection.executemany(
            "INSERT INTO review_decisions_temp VALUES "
            "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    row["candidate_id"],
                    row["decision"],
                    row["selected_company_id"],
                    row["reviewer"],
                    row["reviewer_note"],
                    row["organization_type"],
                    row["review_method"],
                    row["reviewed_at"],
                    json.dumps(row["evidence_ids"]),
                    json.dumps(row["local_entity"]) if row["local_entity"] else None,
                    row["source_release"],
                    row["source_path"],
                    row["source_sha256"],
                    row["source_row_number"],
                )
                for row in reviews
            ],
        )
    connection.execute(
        """
        CREATE TEMP TABLE entity_evidence_temp (
          evidence_id VARCHAR, candidate_id VARCHAR, publisher VARCHAR,
          source_type VARCHAR, source_url VARCHAR, observed_at TIMESTAMPTZ,
          legal_name VARCHAR, country VARCHAR, identifier_type VARCHAR,
          identifier_value VARCHAR, preserved BOOLEAN, content_sha256 VARCHAR,
          source_release VARCHAR, source_path VARCHAR, source_sha256 VARCHAR,
          source_row_number BIGINT
        )
        """
    )
    if evidence:
        connection.executemany(
            "INSERT INTO entity_evidence_temp VALUES "
            "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    row["evidenceId"],
                    row["candidateId"],
                    row["publisher"],
                    row["sourceType"],
                    row["url"],
                    row["observedAt"],
                    row.get("legalName"),
                    row.get("country"),
                    row.get("identifierType"),
                    row.get("identifierValue"),
                    bool(row.get("preserved")),
                    row.get("contentSha256"),
                    row["source_release"],
                    row["source_path"],
                    row["source_sha256"],
                    row["source_row_number"],
                )
                for row in evidence
            ],
        )
    connection.execute(
        """
        CREATE TEMP TABLE entity_review_decisions_temp AS
        SELECT candidate_id, review_decision AS decision, organization_type,
               selected_company_id, review_method, reviewed_at, evidence_ids,
               reviewer, reviewer_note, source_release, source_path,
               source_sha256, source_row_number
        FROM review_decisions_temp
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE review_local_identifiers_temp (
          candidate_id VARCHAR, company_id VARCHAR, identifier_type VARCHAR,
          identifier_value VARCHAR, provider VARCHAR, metadata VARCHAR
        )
        """
    )
    local_identifiers: list[tuple[Any, ...]] = []
    for review in reviews:
        local = review.get("local_entity")
        if not isinstance(local, dict):
            continue
        for identifier in local.get("identifiers") or []:
            local_identifiers.append(
                (
                    review["candidate_id"],
                    local["companyId"],
                    identifier["type"],
                    identifier["value"],
                    identifier.get("provider") or "OFFICIAL_REVIEW",
                    json.dumps(identifier.get("metadata"))
                    if identifier.get("metadata") is not None
                    else None,
                )
            )
    if local_identifiers:
        connection.executemany(
            "INSERT INTO review_local_identifiers_temp VALUES (?, ?, ?, ?, ?, ?)",
            local_identifiers,
        )


def _create_company_matching(
    connection: duckdb.DuckDBPyConnection,
    rules: dict[str, Any],
    reviews: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    on_progress: ProgressCallback,
) -> None:
    prefix_length = int(rules["matching"]["prefixLength"])

    on_progress("Preparing blocked GLEIF alias candidates")
    connection.execute(
        f"""
        CREATE TEMP TABLE candidate_blocks_temp AS
        SELECT DISTINCT country,
               substr(name_normalized, 1, {prefix_length}) AS name_prefix
        FROM company_candidates_temp
        WHERE country IS NOT NULL AND name_normalized <> ''
        """
    )
    _continue_company_matching(connection, rules, reviews, evidence, on_progress)


def _create_company_tables(
    connection: duckdb.DuckDBPyConnection, rules: dict[str, Any]
) -> None:
    suffixes = rules["normalization"]["companySuffixes"]
    relation_start = _sql_identifier("Relationship.StartNode.NodeID")
    relation_end = _sql_identifier("Relationship.EndNode.NodeID")
    relation_type = _sql_identifier("Relationship.RelationshipType")
    relation_status = _sql_identifier("Relationship.RelationshipStatus")
    period_start = _sql_identifier("Relationship.Period.1.startDate")
    period_end = _sql_identifier("Relationship.Period.1.endDate")
    period_type = _sql_identifier("Relationship.Period.1.periodType")
    gleif_legal_name = _sql_identifier("Entity.LegalName")
    gleif_status = _sql_identifier("Entity.EntityStatus")

    connection.execute(
        """
        CREATE TEMP TABLE accepted_company_matches_temp AS
        SELECT DISTINCT candidate_id,
               suggested_company_id AS company_id,
               provider,
               provider_identifier,
               match_method,
               decision
        FROM entity_matches_temp
        WHERE is_accepted AND suggested_company_id IS NOT NULL
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE relationship_edges_temp AS
        SELECT DISTINCT 'cr_' || substr(sha256(
                 r._source_sha256 || '|' || r._source_row_number::VARCHAR
               ), 1, 32) AS company_relation_id,
               'company:gleif:' || r.{relation_start} AS start_company_id,
               'company:gleif:' || r.{relation_end} AS end_company_id,
               r.{relation_type} AS relationship_type,
               r.{relation_status} AS relationship_status,
               try_cast(r.{period_start} AS DATE) AS period_start_date,
               try_cast(r.{period_end} AS DATE) AS period_end_date,
               r.{period_type} AS period_type,
               r._source_release AS source_release,
               r._source_path AS source_path,
               r._source_sha256 AS source_sha256,
               r._source_row_number AS source_row_number
        FROM bronze_gleif_relationships r
        JOIN accepted_company_matches_temp a
          ON a.provider = 'GLEIF'
         AND a.provider_identifier = r.{relation_start}
        JOIN bronze_gleif_entities endpoint ON endpoint.LEI = r.{relation_end}
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE gleif_company_scope_temp AS
        WITH scope_rows AS (
          SELECT company_id, TRUE AS in_patent_scope,
                 FALSE AS relationship_endpoint
          FROM accepted_company_matches_temp WHERE provider = 'GLEIF'
          UNION ALL
          SELECT end_company_id, FALSE, TRUE FROM relationship_edges_temp
        )
        SELECT company_id,
               bool_or(in_patent_scope) AS in_patent_scope,
               bool_or(relationship_endpoint) AS relationship_endpoint
        FROM scope_rows GROUP BY company_id
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE companies_temp AS
        SELECT s.company_id,
               e.{gleif_legal_name} AS preferred_name,
               {_gleif_country_sql('e')} AS country,
               e.{gleif_legal_name} AS legal_name,
               'GLEIF'::VARCHAR AS provider,
               e.{gleif_status} AS entity_status,
               s.in_patent_scope,
               s.relationship_endpoint,
               e._source_release AS source_release,
               e._source_path AS source_path,
               e._source_sha256 AS source_sha256,
               e._source_row_number AS source_row_number
        FROM gleif_company_scope_temp s
        JOIN bronze_gleif_entities e
          ON s.company_id = 'company:gleif:' || e.LEI
        UNION ALL
        SELECT a.company_id,
               arg_min(s.name, s._source_row_number) AS preferred_name,
               NULL::VARCHAR AS country,
               arg_min(s.name, s._source_row_number) AS legal_name,
               'SEC'::VARCHAR AS provider,
               NULL::VARCHAR AS entity_status,
               TRUE AS in_patent_scope,
               FALSE AS relationship_endpoint,
               arg_min(s._source_release, s._source_row_number) AS source_release,
               arg_min(s._source_path, s._source_row_number) AS source_path,
               arg_min(s._source_sha256, s._source_row_number) AS source_sha256,
               min(s._source_row_number) AS source_row_number
        FROM accepted_company_matches_temp a
        JOIN bronze_sec_companies s
          ON a.provider = 'SEC' AND a.provider_identifier = s.cik
        GROUP BY a.company_id
        UNION ALL
        SELECT r.selected_company_id,
               json_extract_string(r.local_entity, '$.preferredName'),
               json_extract_string(r.local_entity, '$.country'),
               json_extract_string(r.local_entity, '$.legalName'),
               'OFFICIAL_REVIEW'::VARCHAR,
               'VERIFIED'::VARCHAR,
               TRUE,
               FALSE,
               e.source_release,
               e.source_path,
               e.source_sha256,
               e.source_row_number
        FROM review_decisions_temp r
        JOIN entity_evidence_temp e
          ON e.evidence_id = json_extract_string(r.evidence_ids, '$[0]')
        WHERE r.review_decision = 'accepted'
          AND r.local_entity IS NOT NULL
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE company_aliases_temp AS
        WITH gleif_aliases AS (
          SELECT c.company_id,
                 u.alias_name,
                 CASE WHEN u.alias_ordinality = 1 THEN 'legal_name'
                      WHEN u.alias_ordinality BETWEEN 2 AND 6 THEN 'other_name'
                      ELSE 'transliterated_other_name' END AS alias_type,
                 'GLEIF'::VARCHAR AS source_provider,
                 e._source_release AS source_release,
                 e._source_path AS source_path,
                 e._source_sha256 AS source_sha256,
                 e._source_row_number AS source_row_number
          FROM companies_temp c
          JOIN bronze_gleif_entities e
            ON c.provider = 'GLEIF'
           AND c.company_id = 'company:gleif:' || e.LEI,
               unnest({_gleif_alias_list_sql('e')}) WITH ORDINALITY AS u(
                 alias_name, alias_ordinality
               )
          WHERE trim(coalesce(u.alias_name, '')) <> ''
        ), sec_aliases AS (
          SELECT DISTINCT c.company_id,
                 s.name AS alias_name,
                 'registered_name'::VARCHAR AS alias_type,
                 'SEC'::VARCHAR AS source_provider,
                 s._source_release AS source_release,
                 s._source_path AS source_path,
                 s._source_sha256 AS source_sha256,
                 s._source_row_number AS source_row_number
          FROM companies_temp c
          JOIN bronze_sec_companies s
            ON c.provider = 'SEC'
           AND c.company_id = 'company:sec:' || s.cik
        ), patent_aliases AS (
          SELECT DISTINCT m.company_id,
                 p.party_name AS alias_name,
                 'patent_assignee'::VARCHAR AS alias_type,
                 'USPTO'::VARCHAR AS source_provider,
                 p.source_release,
                 p.source_path,
                 p.source_sha256,
                 p.source_row_number
          FROM accepted_company_matches_temp m
          JOIN company_candidates_temp c USING (candidate_id)
          JOIN patent_parties_temp p
            ON p.party_name_normalized = c.name_normalized
           AND p.country IS NOT DISTINCT FROM c.country
        ), local_aliases AS (
          SELECT r.selected_company_id AS company_id,
                 json_extract_string(r.local_entity, '$.legalName') AS alias_name,
                 'official_legal_name'::VARCHAR AS alias_type,
                 'OFFICIAL_REVIEW'::VARCHAR AS source_provider,
                 e.source_release,
                 e.source_path,
                 e.source_sha256,
                 e.source_row_number
          FROM review_decisions_temp r
          JOIN entity_evidence_temp e
            ON e.evidence_id = json_extract_string(r.evidence_ids, '$[0]')
          WHERE r.review_decision = 'accepted'
            AND r.local_entity IS NOT NULL
        ), aliases AS (
          SELECT * FROM gleif_aliases
          UNION ALL SELECT * FROM sec_aliases
          UNION ALL SELECT * FROM patent_aliases
          UNION ALL SELECT * FROM local_aliases
        )
        SELECT 'ca_' || substr(sha256(
                 company_id || '|' || source_provider || '|' || alias_type || '|' ||
                 alias_name || '|' || source_sha256 || '|' || source_row_number::VARCHAR
               ), 1, 32) AS alias_id,
               company_id,
               alias_name,
               {_normalized_name_expr('alias_name', suffixes)} AS alias_normalized,
               alias_type,
               source_provider,
               source_release,
               source_path,
               source_sha256,
               source_row_number
        FROM (SELECT DISTINCT * FROM aliases) aliases
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE external_identifiers_temp AS
        WITH identifiers AS (
          SELECT company_id,
                 'LEI'::VARCHAR AS identifier_type,
                 replace(company_id, 'company:gleif:', '') AS identifier_value,
                 'GLEIF'::VARCHAR AS provider,
                 NULL::VARCHAR AS metadata,
                 source_release,
                 source_path,
                 source_sha256,
                 source_row_number
          FROM companies_temp WHERE provider = 'GLEIF'
          UNION ALL
          SELECT c.company_id,
                 'CIK'::VARCHAR,
                 s.cik,
                 'SEC'::VARCHAR,
                 NULL::VARCHAR,
                 s._source_release,
                 s._source_path,
                 s._source_sha256,
                 s._source_row_number
          FROM companies_temp c
          JOIN bronze_sec_companies s
            ON c.provider = 'SEC'
           AND c.company_id = 'company:sec:' || s.cik
          QUALIFY row_number() OVER (
            PARTITION BY c.company_id ORDER BY s._source_row_number
          ) = 1
          UNION ALL
          SELECT DISTINCT c.company_id,
                 'SEC_TICKER'::VARCHAR,
                 s.ticker,
                 'SEC'::VARCHAR,
                 to_json(struct_pack(exchange := s.exchange)),
                 s._source_release,
                 s._source_path,
                 s._source_sha256,
                 s._source_row_number
          FROM companies_temp c
          JOIN bronze_sec_companies s
            ON c.provider = 'SEC'
           AND c.company_id = 'company:sec:' || s.cik
          WHERE trim(coalesce(s.ticker, '')) <> ''
          UNION ALL
          SELECT i.company_id,
                 i.identifier_type,
                 i.identifier_value,
                 i.provider,
                 i.metadata,
                 e.source_release,
                 e.source_path,
                 e.source_sha256,
                 e.source_row_number
          FROM review_local_identifiers_temp i
          JOIN review_decisions_temp r USING (candidate_id)
          JOIN entity_evidence_temp e
            ON e.evidence_id = json_extract_string(r.evidence_ids, '$[0]')
        )
        SELECT 'ei_' || substr(sha256(
                 company_id || '|' || identifier_type || '|' || identifier_value
               ), 1, 32) AS external_identifier_id,
               *
        FROM identifiers
        """
    )
    connection.execute(
        "CREATE TEMP TABLE company_relations_temp AS "
        "SELECT * FROM relationship_edges_temp"
    )
    connection.execute(
        """
        CREATE TEMP TABLE company_patent_relations_temp AS
        SELECT 'cpr_' || substr(sha256(
                 m.company_id || '|' || p.patent_party_id
               ), 1, 32) AS company_patent_relation_id,
               m.company_id,
               p.patent_id,
               p.patent_party_id,
               c.candidate_id,
               m.match_method,
               m.decision AS entity_match_decision
        FROM accepted_company_matches_temp m
        JOIN company_candidates_temp c USING (candidate_id)
        JOIN patent_parties_temp p
          ON p.party_name_normalized = c.name_normalized
         AND p.country IS NOT DISTINCT FROM c.country
        """
    )


def _review_export_query() -> str:
    return """
        WITH candidate_status AS (
          SELECT c.candidate_id,
                 c.representative_name,
                 c.name_normalized,
                 c.country,
                 c.patent_count,
                 c.party_row_count,
                 CASE WHEN bool_or(m.is_accepted) THEN 'accepted'
                      WHEN bool_or(m.decision = 'needs_review') THEN 'needs_review'
                      ELSE 'unmatched' END AS status,
                 max(m.similarity_score) AS best_confidence,
                 arg_max(m.match_method, coalesce(m.similarity_score, -1))
                   AS best_match_method,
                 arg_max(m.suggested_company_id, coalesce(m.similarity_score, -1))
                   AS best_candidate_company_id,
                 arg_max(m.suggested_name, coalesce(m.similarity_score, -1))
                   AS best_candidate_name
          FROM company_candidates_temp c
          JOIN entity_matches_temp m USING (candidate_id)
          GROUP BY c.candidate_id, c.representative_name, c.name_normalized,
                   c.country, c.patent_count, c.party_row_count
        ), suggestions AS (
          SELECT candidate_id,
                 to_json(list(struct_pack(
                   company_id := suggested_company_id,
                   provider := provider,
                   name := suggested_name,
                   country := suggested_country,
                   method := match_method,
                   confidence := similarity_score
                 ) ORDER BY suggestion_rank, suggested_company_id)
                 FILTER (WHERE suggested_company_id IS NOT NULL)) AS suggestions_json
          FROM entity_matches_temp
          GROUP BY candidate_id
        )
        SELECT c.candidate_id,
               c.representative_name AS assignee_name,
               c.name_normalized,
               c.country,
               c.patent_count,
               c.party_row_count,
               c.status,
               c.best_match_method,
               c.best_confidence,
               c.best_candidate_company_id,
               c.best_candidate_name,
               coalesce(s.suggestions_json, '[]') AS suggestions_json,
               ''::VARCHAR AS decision,
               ''::VARCHAR AS selected_company_id,
               ''::VARCHAR AS reviewer,
               ''::VARCHAR AS reviewer_note
        FROM candidate_status c
        LEFT JOIN suggestions s USING (candidate_id)
        WHERE c.status IN ('needs_review', 'unmatched')
          AND NOT EXISTS (
            SELECT 1 FROM review_decisions_temp r
            WHERE r.candidate_id = c.candidate_id
          )
        ORDER BY c.patent_count DESC,
                 c.best_confidence DESC NULLS LAST,
                 c.candidate_id
    """


def _continue_company_matching(
    connection: duckdb.DuckDBPyConnection,
    rules: dict[str, Any],
    reviews: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    on_progress: ProgressCallback,
) -> None:
    suffixes = rules["normalization"]["companySuffixes"]
    prefix_length = int(rules["matching"]["prefixLength"])
    gleif_country = _gleif_country_sql("e")
    gleif_aliases = _gleif_alias_list_sql("e")
    alias_normalized = _normalized_name_expr("aliases.alias_name", suffixes)
    connection.execute(
        f"""
        CREATE TEMP TABLE gleif_alias_pool_temp AS
        WITH candidate_countries AS (
          SELECT DISTINCT country FROM candidate_blocks_temp
        ), entities AS (
          SELECT e.LEI,
                 e.{_sql_identifier('Entity.LegalName')} AS legal_name,
                 {gleif_country} AS country,
                 {gleif_aliases} AS alias_names,
                 e.{_sql_identifier('Entity.EntityStatus')} AS entity_status
          FROM bronze_gleif_entities e
          WHERE {gleif_country} IN (SELECT country FROM candidate_countries)
        ), aliases AS (
          SELECT e.LEI,
                 e.legal_name,
                 e.country,
                 e.entity_status,
                 u.alias_name,
                 u.alias_ordinality
          FROM entities e,
               unnest(e.alias_names) WITH ORDINALITY AS u(
                 alias_name, alias_ordinality
               )
          WHERE trim(coalesce(u.alias_name, '')) <> ''
        ), normalized AS (
          SELECT aliases.*,
                 {alias_normalized} AS alias_normalized
          FROM aliases
        )
        SELECT DISTINCT n.LEI,
               'company:gleif:' || n.LEI AS company_id,
               n.legal_name,
               n.country,
               n.entity_status,
               n.alias_name,
               n.alias_normalized,
               CASE WHEN n.alias_ordinality = 1 THEN 'legal_name'
                    WHEN n.alias_ordinality BETWEEN 2 AND 6 THEN 'other_name'
                    ELSE 'transliterated_other_name' END AS alias_type
        FROM normalized n
        JOIN candidate_blocks_temp b
          ON b.country = n.country
         AND b.name_prefix = substr(n.alias_normalized, 1, {prefix_length})
        WHERE n.alias_normalized <> ''
        """
    )
    _finish_company_matching(connection, rules, reviews, evidence, on_progress)


def _check(
    connection: duckdb.DuckDBPyConnection,
    name: str,
    query: str,
    expected: int,
) -> dict[str, Any]:
    actual = connection.execute(query).fetchone()[0]
    return {
        "name": name,
        "status": "passed" if actual == expected else "failed",
        "expected": expected,
        "actual": actual,
    }


def _quality_checks(
    connection: duckdb.DuckDBPyConnection, rules: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    baseline = rules["qualityBaseline"]
    checks: list[dict[str, Any]] = []
    domain_counts: dict[str, int] = {}
    for domain_id, expected in baseline["domainCounts"].items():
        actual = connection.execute(
            "SELECT count(*) FROM patent_domain_matches_temp WHERE domain_id = ?",
            [domain_id],
        ).fetchone()[0]
        domain_counts[domain_id] = actual
        checks.append(
            {
                "name": f"domain_count.{domain_id}",
                "status": "passed" if actual == int(expected) else "failed",
                "expected": int(expected),
                "actual": actual,
            }
        )
        minimum = int(baseline["minimumPerDomain"])
        checks.append(
            {
                "name": f"domain_minimum.{domain_id}",
                "status": "passed" if actual >= minimum else "failed",
                "expected": f">={minimum}",
                "actual": actual,
            }
        )
    checks.extend(
        [
            _check(
                connection,
                "distinct_patents",
                "SELECT count(*) FROM patents_temp",
                int(baseline["distinctPatents"]),
            ),
            _check(
                connection,
                "cross_domain_overlap",
                """
                SELECT count(*) FROM (
                  SELECT patent_id FROM patent_domain_matches_temp
                  GROUP BY patent_id HAVING count(DISTINCT domain_id) > 1
                )
                """,
                int(baseline["crossDomainOverlap"]),
            ),
            _check(
                connection,
                "included_evidence_invariant",
                f"""
                SELECT count(*) FROM patent_domain_evaluations_temp
                WHERE decision = 'included'
                  AND (total_score < {int(rules['scoring']['threshold'])}
                       OR decision_reason <> 'score_threshold_met')
                """,
                0,
            ),
            _check(
                connection,
                "patent_classifications.orphans",
                """
                SELECT count(*) FROM patent_classifications_temp c
                LEFT JOIN patents_temp p USING (patent_id)
                WHERE p.patent_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "patent_parties.orphans",
                """
                SELECT count(*) FROM patent_parties_temp x
                LEFT JOIN patents_temp p USING (patent_id)
                WHERE p.patent_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "patent_domain_matches.orphans",
                """
                SELECT count(*) FROM patent_domain_matches_temp d
                LEFT JOIN patents_temp p USING (patent_id)
                LEFT JOIN patent_domain_evaluations_temp e USING (evaluation_id)
                WHERE p.patent_id IS NULL OR e.evaluation_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "entity_matches.orphans",
                """
                SELECT count(*) FROM entity_matches_temp m
                LEFT JOIN company_candidates_temp c USING (candidate_id)
                WHERE c.candidate_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "company_patent_relations.company_orphans",
                """
                SELECT count(*) FROM company_patent_relations_temp r
                LEFT JOIN companies_temp c USING (company_id)
                WHERE c.company_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "company_patent_relations.patent_orphans",
                """
                SELECT count(*) FROM company_patent_relations_temp r
                LEFT JOIN patents_temp p USING (patent_id)
                WHERE p.patent_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "company_relations.start_orphans",
                """
                SELECT count(*) FROM company_relations_temp r
                LEFT JOIN companies_temp c ON c.company_id = r.start_company_id
                WHERE c.company_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "company_relations.end_orphans",
                """
                SELECT count(*) FROM company_relations_temp r
                LEFT JOIN companies_temp c ON c.company_id = r.end_company_id
                WHERE c.company_id IS NULL
                """,
                0,
            ),
            _check(
                connection,
                "auto_acceptance_policy",
                """
                SELECT count(*) FROM entity_matches_temp
                WHERE decision = 'auto_accepted'
                  AND (provider <> 'GLEIF'
                       OR match_method <> 'gleif_exact_name_country'
                       OR candidate_country IS NULL
                       OR similarity_score <> 1.0)
                """,
                0,
            ),
            _check(
                connection,
                "fuzzy_suggestion_limit",
                """
                SELECT count(*) FROM (
                  SELECT candidate_id FROM entity_matches_temp
                  WHERE match_method = 'gleif_fuzzy_name_country'
                  GROUP BY candidate_id
                  HAVING count(*) >
                """
                + str(int(rules["matching"]["maxSuggestions"]))
                + ")",
                0,
            ),
        ]
    )
    unique_checks = {
        "patent_domain_evaluations": (
            "patent_domain_evaluations_temp",
            "evaluation_id",
        ),
        "patents": ("patents_temp", "patent_id"),
        "patent_classifications": (
            "patent_classifications_temp",
            "classification_id",
        ),
        "patent_parties": ("patent_parties_temp", "patent_party_id"),
        "patent_domain_matches": (
            "patent_domain_matches_temp",
            "domain_match_id",
        ),
        "company_candidates": ("company_candidates_temp", "candidate_id"),
        "entity_matches": ("entity_matches_temp", "entity_match_id"),
        "companies": ("companies_temp", "company_id"),
        "company_aliases": ("company_aliases_temp", "alias_id"),
        "external_identifiers": (
            "external_identifiers_temp",
            "external_identifier_id",
        ),
        "company_relations": ("company_relations_temp", "company_relation_id"),
        "company_patent_relations": (
            "company_patent_relations_temp",
            "company_patent_relation_id",
        ),
        "entity_review_decisions": (
            "entity_review_decisions_temp",
            "candidate_id",
        ),
        "entity_evidence": ("entity_evidence_temp", "evidence_id"),
    }
    for label, (table, identifier) in unique_checks.items():
        checks.append(
            _check(
                connection,
                f"{label}.duplicate_ids",
                f"SELECT count(*) - count(DISTINCT {identifier}) FROM {table}",
                0,
            )
        )
    metrics = {
        "domainCounts": domain_counts,
        "distinctPatentCount": connection.execute(
            "SELECT count(*) FROM patents_temp"
        ).fetchone()[0],
        "companyCandidateCount": connection.execute(
            "SELECT count(*) FROM company_candidates_temp"
        ).fetchone()[0],
        "autoAcceptedCandidateCount": connection.execute(
            """
            SELECT count(DISTINCT candidate_id) FROM entity_matches_temp
            WHERE decision = 'auto_accepted' AND is_accepted
            """
        ).fetchone()[0],
        "humanAcceptedCandidateCount": connection.execute(
            """
            SELECT count(DISTINCT candidate_id) FROM entity_matches_temp
            WHERE decision = 'human_accepted' AND is_accepted
            """
        ).fetchone()[0],
        "evidenceAcceptedCandidateCount": connection.execute(
            """
            SELECT count(DISTINCT candidate_id) FROM entity_matches_temp
            WHERE decision = 'evidence_accepted' AND is_accepted
            """
        ).fetchone()[0],
        "terminalReviewDecisionCount": connection.execute(
            "SELECT count(*) FROM entity_review_decisions_temp"
        ).fetchone()[0],
        "reviewQueueCount": connection.execute(
            "SELECT count(*) FROM (" + _review_export_query() + ")"
        ).fetchone()[0],
    }
    return checks, metrics


def _validate_checks(checks: list[dict[str, Any]]) -> None:
    failures = [check for check in checks if check["status"] != "passed"]
    if failures:
        summary = "; ".join(
            f"{check['name']}: expected {check['expected']}, got {check['actual']}"
            for check in failures
        )
        raise SilverError(f"Silver quality checks failed: {summary}")


def _copy_parquet(
    connection: duckdb.DuckDBPyConnection,
    table: str,
    path: Path,
    order_by: str,
    rules: dict[str, Any],
) -> None:
    settings = rules["duckdb"]
    connection.execute(
        f"COPY (SELECT * FROM {table} ORDER BY {order_by}) "
        f"TO {_sql_literal(path.resolve())} (FORMAT PARQUET, "
        f"COMPRESSION {_sql_literal(settings['compression'])}, "
        f"ROW_GROUP_SIZE {int(settings['rowGroupSize'])})"
    )


def _write_outputs(
    connection: duckdb.DuckDBPyConnection,
    release_root: Path,
    rules: dict[str, Any],
) -> list[dict[str, Any]]:
    table_mapping = {
        "patent-domain-evaluations": (
            "patent_domain_evaluations_temp",
            "domain_id, patent_id",
        ),
        "patents": ("patents_temp", "patent_id"),
        "patent-classifications": (
            "patent_classifications_temp",
            "patent_id, cpc_sequence NULLS LAST, classification_id",
        ),
        "patent-parties": (
            "patent_parties_temp",
            "patent_id, party_sequence NULLS LAST, patent_party_id",
        ),
        "patent-domain-matches": (
            "patent_domain_matches_temp",
            "domain_id, patent_id",
        ),
        "company-candidates": ("company_candidates_temp", "candidate_id"),
        "entity-matches": (
            "entity_matches_temp",
            "candidate_id, suggestion_rank, suggested_company_id NULLS LAST",
        ),
        "companies": ("companies_temp", "company_id"),
        "company-aliases": ("company_aliases_temp", "company_id, alias_id"),
        "external-identifiers": (
            "external_identifiers_temp",
            "company_id, identifier_type, identifier_value",
        ),
        "company-relations": (
            "company_relations_temp",
            "start_company_id, end_company_id, company_relation_id",
        ),
        "company-patent-relations": (
            "company_patent_relations_temp",
            "company_id, patent_id, company_patent_relation_id",
        ),
        "entity-review-decisions": (
            "entity_review_decisions_temp",
            "candidate_id",
        ),
        "entity-evidence": ("entity_evidence_temp", "candidate_id, evidence_id"),
    }
    files: list[dict[str, Any]] = []
    for dataset, relative_path in PARQUET_OUTPUTS:
        table, order_by = table_mapping[dataset]
        path = release_root / relative_path
        _copy_parquet(connection, table, path, order_by, rules)
        schema = _parquet_schema(connection, path)
        files.append(
            {
                "dataset": dataset,
                "path": relative_path,
                "format": "parquet",
                "rowCount": connection.execute(
                    f"SELECT count(*) FROM {table}"
                ).fetchone()[0],
                "columnCount": len(schema),
                "schema": schema,
                "sizeBytes": path.stat().st_size,
                "sha256": _sha256_file(path),
            }
        )
    review_path = release_root / "entity_review.csv"
    review_query = _review_export_query()
    connection.execute(
        f"COPY ({review_query}) TO {_sql_literal(review_path.resolve())} "
        "(FORMAT CSV, HEADER TRUE, DELIMITER ',', QUOTE '\"', ESCAPE '\"')"
    )
    review_schema_rows = connection.execute(f"DESCRIBE {review_query}").fetchall()
    review_schema = [{"name": row[0], "type": row[1]} for row in review_schema_rows]
    review_rows = connection.execute(
        "SELECT count(*) FROM (" + review_query + ")"
    ).fetchone()[0]
    files.append(
        {
            "dataset": "entity-review",
            "path": "entity_review.csv",
            "format": "csv",
            "rowCount": review_rows,
            "columnCount": len(review_schema),
            "schema": review_schema,
            "sizeBytes": review_path.stat().st_size,
            "sha256": _sha256_file(review_path),
        }
    )
    domains_path = release_root / "domains.jsonl"
    domain_records = [
        {
            "domainId": domain["id"],
            "name": domain["name"],
            "ruleVersion": rules["ruleVersion"],
            "period": rules["period"],
            "scoring": rules["scoring"],
            "exactCpcPrefixes": domain["exactCpcPrefixes"],
            "broadCpcPrefixes": domain["broadCpcPrefixes"],
            "generalTitleTerms": domain["generalTitleTerms"],
            "strongTitleTerms": domain["strongTitleTerms"],
            "exclusionTitleTerms": domain["exclusionTitleTerms"],
        }
        for domain in rules["domains"]
    ]
    domains_path.write_text(
        "".join(
            json.dumps(record, ensure_ascii=False) + "\n"
            for record in domain_records
        ),
        encoding="utf-8",
    )
    domains_schema = [
        {"name": key, "type": "JSON"} for key in domain_records[0]
    ]
    files.append(
        {
            "dataset": "domains",
            "path": "domains.jsonl",
            "format": "jsonl",
            "rowCount": len(domain_records),
            "columnCount": len(domains_schema),
            "schema": domains_schema,
            "sizeBytes": domains_path.stat().st_size,
            "sha256": _sha256_file(domains_path),
        }
    )
    return files


def _finish_company_matching(
    connection: duckdb.DuckDBPyConnection,
    rules: dict[str, Any],
    reviews: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    on_progress: ProgressCallback,
) -> None:
    connection.execute(
        """
        CREATE TEMP TABLE gleif_exact_hits_temp AS
        SELECT DISTINCT c.candidate_id,
               a.company_id,
               a.LEI AS provider_identifier,
               a.legal_name AS suggested_name,
               a.country AS suggested_country,
               a.alias_name AS matched_alias,
               a.alias_type
        FROM company_candidates_temp c
        JOIN gleif_alias_pool_temp a
          ON a.country = c.country
         AND a.alias_normalized = c.name_normalized
        WHERE c.country IS NOT NULL
        """
    )
    _last_company_matching(connection, rules, reviews, evidence, on_progress)


def _csv_file_details(path: Path) -> tuple[int, list[str]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source)
            header = next(reader)
            return sum(1 for _row in reader), header
    except (OSError, StopIteration, csv.Error) as error:
        raise SilverError(f"Unable to inspect CSV file {path}: {error}") from error


def _jsonl_file_details(path: Path) -> tuple[int, list[str]]:
    count = 0
    keys: list[str] | None = None
    try:
        with path.open("r", encoding="utf-8") as source:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    raise SilverError(f"Blank JSONL line {line_number}: {path}")
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise SilverError(
                        f"JSONL line {line_number} is not an object: {path}"
                    )
                current_keys = list(value)
                if keys is None:
                    keys = current_keys
                elif current_keys != keys:
                    raise SilverError(
                        f"JSONL keys differ at line {line_number}: {path}"
                    )
                count += 1
    except (OSError, json.JSONDecodeError) as error:
        raise SilverError(f"Unable to inspect JSONL file {path}: {error}") from error
    return count, keys or []


def _verify_recorded_input(
    label: str, entry: dict[str, Any] | None, *, required: bool
) -> None:
    if entry is None:
        if required:
            raise SilverError(f"Silver manifest has no {label}")
        return
    path_value = entry.get("path")
    expected_hash = entry.get("sha256")
    if not isinstance(path_value, str) or not path_value:
        raise SilverError(f"Silver manifest has invalid {label} path")
    if not isinstance(expected_hash, str) or not SHA256_PATTERN.fullmatch(
        expected_hash
    ):
        raise SilverError(f"Silver manifest has invalid {label} SHA-256")
    path = Path(path_value)
    if not path.is_file():
        raise SilverError(f"Recorded {label} is missing: {path}")
    if _sha256_file(path) != expected_hash:
        raise SilverError(f"Recorded {label} SHA-256 has changed: {path}")


def verify_silver(
    *,
    manifest_path: Path,
    on_progress: ProgressCallback = lambda _message: None,
) -> dict[str, Any]:
    """Verify Silver inputs, output hashes, schemas, row counts, and release scope."""
    manifest_path = manifest_path.resolve()
    manifest = _read_json(manifest_path)
    if manifest.get("layer") != "silver":
        raise SilverError("Manifest is not a Silver release")
    files = manifest.get("files")
    if not isinstance(files, list) or manifest.get("fileCount") != len(files):
        raise SilverError("Silver manifest fileCount is invalid")
    bronze_entry = manifest.get("bronzeManifest")
    _verify_recorded_input("Bronze manifest", bronze_entry, required=True)
    _verify_recorded_input("rules file", manifest.get("rules"), required=True)
    review_entry = manifest.get("reviewFile")
    _verify_recorded_input("review file", review_entry, required=False)
    evidence_entry = manifest.get("reviewEvidenceManifest")
    _verify_recorded_input(
        "review evidence manifest", evidence_entry, required=False
    )
    if evidence_entry is not None:
        try:
            verify_entity_review(Path(evidence_entry["path"]))
        except EntityReviewError as error:
            raise SilverError(
                f"Review evidence verification failed: {error}"
            ) from error
    try:
        verify_bronze(
            manifest_path=Path(bronze_entry["path"]), on_progress=on_progress
        )
    except BronzeError as error:
        raise SilverError(f"Bronze verification failed: {error}") from error

    release_root = manifest_path.parent
    connection = duckdb.connect(":memory:")
    total_rows = 0
    total_size = 0
    try:
        for index, file in enumerate(files, start=1):
            relative_path = _normalize_relative_path(file.get("path", ""))
            on_progress(f"Verifying Silver [{index}/{len(files)}] {relative_path}")
            path = release_root / relative_path
            if not path.is_file():
                raise SilverError(f"Silver file is missing: {relative_path}")
            actual_size = path.stat().st_size
            if actual_size != file.get("sizeBytes"):
                raise SilverError(
                    f"Silver size mismatch for {relative_path}: "
                    f"expected {file.get('sizeBytes')}, got {actual_size}"
                )
            expected_hash = file.get("sha256")
            if not isinstance(expected_hash, str) or not SHA256_PATTERN.fullmatch(
                expected_hash
            ):
                raise SilverError(f"Invalid Silver SHA-256 for {relative_path}")
            if _sha256_file(path) != expected_hash:
                raise SilverError(f"Silver SHA-256 mismatch for {relative_path}")
            file_format = file.get("format")
            if file_format == "parquet":
                actual_rows = connection.execute(
                    f"SELECT count(*) FROM read_parquet({_sql_literal(path)})"
                ).fetchone()[0]
                actual_schema = _parquet_schema(connection, path)
                if actual_schema != file.get("schema"):
                    raise SilverError(f"Silver schema mismatch for {relative_path}")
            elif file_format == "csv":
                actual_rows, header = _csv_file_details(path)
                expected_names = [column["name"] for column in file.get("schema", [])]
                if header != expected_names:
                    raise SilverError(f"Silver CSV header mismatch for {relative_path}")
                actual_schema = file["schema"]
            elif file_format == "jsonl":
                actual_rows, keys = _jsonl_file_details(path)
                expected_names = [column["name"] for column in file.get("schema", [])]
                if keys != expected_names:
                    raise SilverError(f"Silver JSONL keys mismatch for {relative_path}")
                actual_schema = file["schema"]
            else:
                raise SilverError(f"Unsupported Silver format: {file_format}")
            if actual_rows != file.get("rowCount"):
                raise SilverError(
                    f"Silver row count mismatch for {relative_path}: "
                    f"expected {file.get('rowCount')}, got {actual_rows}"
                )
            if len(actual_schema) != file.get("columnCount"):
                raise SilverError(f"Silver column count mismatch for {relative_path}")
            total_rows += actual_rows
            total_size += actual_size
    finally:
        connection.close()
    if total_rows != manifest.get("totalRows"):
        raise SilverError("Silver manifest totalRows is invalid")
    if total_size != manifest.get("totalSizeBytes"):
        raise SilverError("Silver manifest totalSizeBytes is invalid")
    quality_entry = manifest.get("qualityReport")
    if not isinstance(quality_entry, dict):
        raise SilverError("Silver manifest qualityReport is invalid")
    quality_path = release_root / _normalize_relative_path(
        quality_entry.get("path", "")
    )
    if not quality_path.is_file():
        raise SilverError("Silver quality report is missing")
    if quality_path.stat().st_size != quality_entry.get("sizeBytes"):
        raise SilverError("Silver quality report size mismatch")
    if _sha256_file(quality_path) != quality_entry.get("sha256"):
        raise SilverError("Silver quality report SHA-256 mismatch")
    quality_report = _read_json(quality_path)
    if quality_report.get("status") not in {"passed", "review_required"}:
        raise SilverError("Silver quality report has an invalid status")
    if bool(quality_report.get("publishable")) != bool(manifest.get("publishable")):
        raise SilverError("Silver publishable status differs from quality report")
    expected_paths = {
        _normalize_relative_path(file["path"]) for file in files
    } | {"manifest.json", _normalize_relative_path(quality_entry["path"])}
    actual_paths = {
        path.relative_to(release_root).as_posix()
        for path in release_root.rglob("*")
        if path.is_file()
    }
    if actual_paths != expected_paths:
        missing = sorted(expected_paths - actual_paths)
        unexpected = sorted(actual_paths - expected_paths)
        raise SilverError(
            f"Silver release file set mismatch; missing={missing}, "
            f"unexpected={unexpected}"
        )
    on_progress(f"Verified Silver release: {manifest['release']}")
    return manifest


def build_silver(
    *,
    bronze_manifest_path: Path,
    rules_path: Path,
    version: str,
    review_file_path: Path | None = None,
    review_evidence_manifest_path: Path | None = None,
    on_progress: ProgressCallback = lambda _message: None,
) -> dict[str, Any]:
    """Build a versioned Silver release, or verify the immutable existing version."""
    if not VERSION_PATTERN.fullmatch(version):
        raise SilverError(
            "version must contain lowercase letters, numbers, dots or dashes"
        )
    bronze_manifest_path = bronze_manifest_path.resolve()
    rules_path = rules_path.resolve()
    review_file_path = review_file_path.resolve() if review_file_path else None
    review_evidence_manifest_path = (
        review_evidence_manifest_path.resolve()
        if review_evidence_manifest_path
        else None
    )
    rules = _read_rules(rules_path)
    reviews = _read_reviews(review_file_path)
    review_evidence, review_evidence_manifest = _read_review_evidence(
        review_evidence_manifest_path
    )
    bronze_hash = _sha256_file(bronze_manifest_path)
    rules_hash = _sha256_file(rules_path)
    review_hash = _sha256_file(review_file_path) if review_file_path else None
    review_evidence_hash = (
        _sha256_file(review_evidence_manifest_path)
        if review_evidence_manifest_path
        else None
    )
    bronze_manifest = _read_json(bronze_manifest_path)
    if bronze_manifest.get("layer") != "bronze":
        raise SilverError("Input manifest is not a Bronze release")
    bronze_root = bronze_manifest_path.parent
    data_root = bronze_root.parent.parent
    release_name = rules["releaseName"]
    release_root = data_root / "silver" / release_name / version
    manifest_path = release_root / "manifest.json"
    if release_root.exists():
        if not manifest_path.is_file():
            raise SilverError(
                f"Existing Silver directory has no manifest: {release_root}"
            )
        existing = _read_json(manifest_path)
        comparisons = {
            "Bronze manifest": (
                existing.get("bronzeManifest", {}).get("sha256"),
                bronze_hash,
            ),
            "rules": (existing.get("rules", {}).get("sha256"), rules_hash),
            "review file": (
                (existing.get("reviewFile") or {}).get("sha256"),
                review_hash,
            ),
            "review evidence manifest": (
                (existing.get("reviewEvidenceManifest") or {}).get("sha256"),
                review_evidence_hash,
            ),
        }
        changed = [
            label for label, (recorded, current) in comparisons.items()
            if recorded != current
        ]
        if changed:
            raise SilverError(
                "Existing Silver version uses different inputs ("
                + ", ".join(changed)
                + "); choose a new --version"
            )
        on_progress(f"Silver release already exists; verifying {version}")
        return verify_silver(manifest_path=manifest_path, on_progress=on_progress)
    try:
        on_progress("Verifying Bronze release and input hashes")
        verify_bronze(manifest_path=bronze_manifest_path, on_progress=on_progress)
    except BronzeError as error:
        raise SilverError(f"Bronze verification failed: {error}") from error
    paths = _bronze_paths(bronze_manifest, bronze_root)
    silver_root = data_root / "silver" / release_name
    silver_root.mkdir(parents=True, exist_ok=True)
    temporary_root = silver_root / f".{version}.tmp-{os.getpid()}"
    if temporary_root.exists():
        raise SilverError(f"Temporary build directory already exists: {temporary_root}")
    temporary_root.mkdir()
    connection = duckdb.connect(":memory:")
    try:
        _configure_duckdb(
            connection, rules, temporary_root / ".duckdb-temporary"
        )
        _create_bronze_views(connection, paths)
        on_progress("Evaluating patent domains from full CPC and titles")
        _create_domain_evaluations(connection, rules)
        on_progress("Building normalized patent and assignee candidate tables")
        _create_patent_tables(connection, rules)
        _create_company_matching(
            connection, rules, reviews, review_evidence, on_progress
        )
        on_progress("Building accepted company, relation, and identifier tables")
        _create_company_tables(connection, rules)
        on_progress("Running Silver quality checks")
        checks, metrics = _quality_checks(connection, rules)
        _validate_checks(checks)
        human_acceptances = metrics["humanAcceptedCandidateCount"]
        required_acceptances = int(rules["matching"]["minimumHumanAcceptances"])
        publishable = human_acceptances >= required_acceptances
        status = "passed" if publishable else "review_required"
        on_progress("Writing deterministic Silver Parquet and review files")
        files = _write_outputs(connection, temporary_root, rules)
        generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        quality_report = {
            "schemaVersion": "1.0.0",
            "release": version,
            "generatedAt": generated_at,
            "status": status,
            "structureStatus": "passed",
            "publishable": publishable,
            "minimumHumanAcceptances": required_acceptances,
            "metrics": metrics,
            "checkCount": len(checks),
            "checks": checks,
        }
        quality_path = temporary_root / "quality_report.json"
        _write_json(quality_path, quality_report)
        total_rows = sum(file["rowCount"] for file in files)
        total_size = sum(file["sizeBytes"] for file in files)
        manifest = {
            "schemaVersion": rules["schemaVersion"],
            "release": version,
            "dataset": release_name,
            "layer": "silver",
            "status": status,
            "publishable": publishable,
            "generatedAt": generated_at,
            "duckdbVersion": duckdb.__version__,
            "bronzeRelease": bronze_manifest["release"],
            "bronzeManifest": {
                "path": str(bronze_manifest_path),
                "sha256": bronze_hash,
            },
            "rules": {
                "path": str(rules_path),
                "sha256": rules_hash,
                "ruleVersion": rules["ruleVersion"],
            },
            "reviewFile": (
                {"path": str(review_file_path), "sha256": review_hash}
                if review_file_path
                else None
            ),
            "reviewEvidenceManifest": (
                {
                    "path": str(review_evidence_manifest_path),
                    "sha256": review_evidence_hash,
                    "release": review_evidence_manifest.get("release"),
                }
                if review_evidence_manifest_path and review_evidence_manifest
                else None
            ),
            "period": rules["period"],
            "normalizationVersion": rules["normalization"]["version"],
            "unavailableSourceFields": [
                "abstract",
                "claim_text",
                "patent_family_id",
            ],
            "fileCount": len(files),
            "totalRows": total_rows,
            "totalSizeBytes": total_size,
            "files": files,
            "qualityReport": {
                "path": "quality_report.json",
                "sizeBytes": quality_path.stat().st_size,
                "sha256": _sha256_file(quality_path),
            },
        }
        _write_json(temporary_root / "manifest.json", manifest)
        duckdb_temp = temporary_root / ".duckdb-temporary"
        if duckdb_temp.exists() and not any(duckdb_temp.iterdir()):
            duckdb_temp.rmdir()
        temporary_root.replace(release_root)
        on_progress(f"Silver release written: {release_root}")
        return manifest
    finally:
        connection.close()


def _default_rules_path() -> Path:
    return (
        Path(__file__).resolve().parents[5]
        / "config"
        / "domains"
        / "ai-domains-v1.yaml"
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build", help="Build an immutable Silver release")
    build.add_argument("--bronze-manifest", type=Path, required=True)
    build.add_argument("--rules", type=Path, default=_default_rules_path())
    build.add_argument("--version", required=True)
    build.add_argument("--review-file", type=Path)
    build.add_argument("--review-evidence-manifest", type=Path)
    verify = subparsers.add_parser("verify", help="Verify a Silver release")
    verify.add_argument("--manifest", type=Path, required=True)
    return parser


def main() -> None:
    args = _parser().parse_args()
    if args.command == "build":
        manifest = build_silver(
            bronze_manifest_path=args.bronze_manifest,
            rules_path=args.rules,
            version=args.version,
            review_file_path=args.review_file,
            review_evidence_manifest_path=args.review_evidence_manifest,
            on_progress=print,
        )
    else:
        manifest = verify_silver(manifest_path=args.manifest, on_progress=print)
    print(
        f"{manifest['release']}: {manifest['fileCount']} files, "
        f"{manifest['totalRows']:,} rows, {manifest['totalSizeBytes']:,} bytes, "
        f"status={manifest['status']}, publishable={manifest['publishable']}"
    )


def _last_company_matching(
    connection: duckdb.DuckDBPyConnection,
    rules: dict[str, Any],
    reviews: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    on_progress: ProgressCallback,
) -> None:
    suffixes = rules["normalization"]["companySuffixes"]
    prefix_length = int(rules["matching"]["prefixLength"])
    fuzzy_threshold = float(rules["matching"]["fuzzyThreshold"])
    max_suggestions = int(rules["matching"]["maxSuggestions"])
    sec_normalized = _normalized_name_expr("s.name", suffixes)
    connection.execute(
        f"""
        CREATE TEMP TABLE sec_exact_hits_temp AS
        WITH normalized AS (
          SELECT s.cik,
                 s.name,
                 {sec_normalized} AS name_normalized
          FROM bronze_sec_companies s
        )
        SELECT c.candidate_id,
               'company:sec:' || n.cik AS company_id,
               n.cik AS provider_identifier,
               min(n.name) AS suggested_name
        FROM company_candidates_temp c
        JOIN normalized n ON n.name_normalized = c.name_normalized
        GROUP BY c.candidate_id, n.cik
        """
    )
    on_progress("Scoring country and prefix-blocked GLEIF fuzzy candidates")
    connection.execute(
        f"""
        CREATE TEMP TABLE gleif_fuzzy_hits_temp AS
        WITH exact_counts AS (
          SELECT candidate_id, count(DISTINCT company_id) AS hit_count
          FROM gleif_exact_hits_temp GROUP BY candidate_id
        ), similarities AS (
          SELECT c.candidate_id,
                 a.company_id,
                 a.LEI AS provider_identifier,
                 a.legal_name AS suggested_name,
                 a.country AS suggested_country,
                 max(jaro_winkler_similarity(
                   c.name_normalized, a.alias_normalized
                 )) AS similarity_score
          FROM company_candidates_temp c
          JOIN gleif_alias_pool_temp a
            ON a.country = c.country
           AND substr(a.alias_normalized, 1, {prefix_length}) =
               substr(c.name_normalized, 1, {prefix_length})
          LEFT JOIN exact_counts x ON x.candidate_id = c.candidate_id
          WHERE coalesce(x.hit_count, 0) = 0
            AND jaro_winkler_similarity(
                  c.name_normalized, a.alias_normalized
                ) >= {fuzzy_threshold}
          GROUP BY c.candidate_id, a.company_id, a.LEI, a.legal_name, a.country
        ), ranked AS (
          SELECT *, row_number() OVER (
                   PARTITION BY candidate_id
                   ORDER BY similarity_score DESC, company_id
                 ) AS suggestion_rank
          FROM similarities
        )
        SELECT * FROM ranked WHERE suggestion_rank <= {max_suggestions}
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE entity_resolution_temp AS
        WITH gleif_exact AS (
          SELECT candidate_id, count(DISTINCT company_id) AS hit_count
          FROM gleif_exact_hits_temp GROUP BY candidate_id
        ), sec_exact AS (
          SELECT candidate_id, count(DISTINCT company_id) AS hit_count
          FROM sec_exact_hits_temp GROUP BY candidate_id
        ), fuzzy AS (
          SELECT candidate_id, count(*) AS hit_count
          FROM gleif_fuzzy_hits_temp GROUP BY candidate_id
        )
        SELECT c.candidate_id,
               CASE WHEN c.country IS NULL THEN 'needs_review'
                    WHEN coalesce(g.hit_count, 0) = 1 THEN 'auto_accepted'
                    WHEN coalesce(g.hit_count, 0) > 1 THEN 'needs_review'
                    WHEN coalesce(s.hit_count, 0) > 0 THEN 'needs_review'
                    WHEN coalesce(f.hit_count, 0) > 0 THEN 'needs_review'
                    ELSE 'unmatched' END AS resolution_status,
               CASE WHEN c.country IS NULL THEN 'missing_country'
                    WHEN coalesce(g.hit_count, 0) = 1 THEN 'gleif_exact_name_country'
                    WHEN coalesce(g.hit_count, 0) > 1 THEN 'gleif_exact_multiple'
                    WHEN coalesce(s.hit_count, 0) > 0 THEN 'sec_exact_name'
                    WHEN coalesce(f.hit_count, 0) > 0 THEN 'gleif_fuzzy_name_country'
                    ELSE 'no_candidate' END AS resolution_method,
               coalesce(g.hit_count, 0)::INTEGER AS gleif_exact_count,
               coalesce(s.hit_count, 0)::INTEGER AS sec_exact_count,
               coalesce(f.hit_count, 0)::INTEGER AS fuzzy_count
        FROM company_candidates_temp c
        LEFT JOIN gleif_exact g USING (candidate_id)
        LEFT JOIN sec_exact s USING (candidate_id)
        LEFT JOIN fuzzy f USING (candidate_id)
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE entity_suggestions_base_temp AS
        WITH gleif_exact AS (
          SELECT c.candidate_id,
                 g.company_id AS suggested_company_id,
                 'GLEIF'::VARCHAR AS provider,
                 g.provider_identifier,
                 g.suggested_name,
                 g.suggested_country,
                 'gleif_exact_name_country'::VARCHAR AS match_method,
                 1.0::DOUBLE AS similarity_score,
                 row_number() OVER (
                   PARTITION BY c.candidate_id ORDER BY g.company_id
                 )::INTEGER AS suggestion_rank
          FROM company_candidates_temp c
          JOIN gleif_exact_hits_temp g USING (candidate_id)
        ), sec_exact AS (
          SELECT c.candidate_id,
                 s.company_id AS suggested_company_id,
                 'SEC'::VARCHAR AS provider,
                 s.provider_identifier,
                 s.suggested_name,
                 NULL::VARCHAR AS suggested_country,
                 'sec_exact_name'::VARCHAR AS match_method,
                 1.0::DOUBLE AS similarity_score,
                 row_number() OVER (
                   PARTITION BY c.candidate_id ORDER BY s.company_id
                 )::INTEGER AS suggestion_rank
          FROM company_candidates_temp c
          JOIN sec_exact_hits_temp s USING (candidate_id)
          JOIN entity_resolution_temp r USING (candidate_id)
          WHERE r.gleif_exact_count = 0
        ), fuzzy AS (
          SELECT c.candidate_id,
                 f.company_id AS suggested_company_id,
                 'GLEIF'::VARCHAR AS provider,
                 f.provider_identifier,
                 f.suggested_name,
                 f.suggested_country,
                 'gleif_fuzzy_name_country'::VARCHAR AS match_method,
                 f.similarity_score,
                 f.suggestion_rank::INTEGER
          FROM company_candidates_temp c
          JOIN gleif_fuzzy_hits_temp f USING (candidate_id)
          JOIN entity_resolution_temp r USING (candidate_id)
          WHERE r.gleif_exact_count = 0 AND r.sec_exact_count = 0
        ), suggestions AS (
          SELECT * FROM gleif_exact
          UNION ALL SELECT * FROM sec_exact
          UNION ALL SELECT * FROM fuzzy
        ), placeholders AS (
          SELECT c.candidate_id,
                 NULL::VARCHAR AS suggested_company_id,
                 NULL::VARCHAR AS provider,
                 NULL::VARCHAR AS provider_identifier,
                 NULL::VARCHAR AS suggested_name,
                 NULL::VARCHAR AS suggested_country,
                 r.resolution_method AS match_method,
                 NULL::DOUBLE AS similarity_score,
                 1::INTEGER AS suggestion_rank
          FROM company_candidates_temp c
          JOIN entity_resolution_temp r USING (candidate_id)
          WHERE NOT EXISTS (
            SELECT 1 FROM suggestions s WHERE s.candidate_id = c.candidate_id
          )
        )
        SELECT s.*,
               r.resolution_status AS base_decision,
               CASE WHEN r.resolution_status = 'auto_accepted'
                      THEN 'unique_gleif_name_and_country'
                    WHEN r.resolution_method = 'missing_country'
                      THEN 'country_required_for_auto_acceptance'
                    WHEN r.resolution_method = 'gleif_exact_multiple'
                      THEN 'multiple_gleif_entities'
                    WHEN r.resolution_method = 'sec_exact_name'
                      THEN 'sec_name_requires_human_review'
                    WHEN r.resolution_method = 'gleif_fuzzy_name_country'
                      THEN 'fuzzy_name_requires_human_review'
                    ELSE 'no_entity_candidate_found' END AS base_reason
        FROM (
          SELECT * FROM suggestions UNION ALL SELECT * FROM placeholders
        ) s
        JOIN entity_resolution_temp r USING (candidate_id)
        """
    )
    _create_review_table(connection, reviews, evidence)
    missing_candidates = connection.execute(
        """
        SELECT count(*) FROM review_decisions_temp r
        LEFT JOIN company_candidates_temp c USING (candidate_id)
        WHERE c.candidate_id IS NULL
        """
    ).fetchone()[0]
    if missing_candidates:
        raise SilverError(
            f"Review file contains {missing_candidates} unknown candidate_id values"
        )
    connection.execute(
        f"""
        CREATE TEMP TABLE review_selected_catalog_temp AS
        SELECT r.candidate_id,
               r.selected_company_id,
               'GLEIF'::VARCHAR AS provider,
               e.LEI AS provider_identifier,
               e.{_sql_identifier('Entity.LegalName')} AS suggested_name,
               {_gleif_country_sql('e')} AS suggested_country
        FROM review_decisions_temp r
        JOIN bronze_gleif_entities e
          ON r.selected_company_id = 'company:gleif:' || e.LEI
        WHERE r.review_decision = 'accepted'
        UNION ALL
        SELECT r.candidate_id,
               r.selected_company_id,
               'SEC'::VARCHAR AS provider,
               s.cik AS provider_identifier,
               min(s.name) AS suggested_name,
               NULL::VARCHAR AS suggested_country
        FROM review_decisions_temp r
        JOIN bronze_sec_companies s
          ON r.selected_company_id = 'company:sec:' || s.cik
        WHERE r.review_decision = 'accepted'
        GROUP BY r.candidate_id, r.selected_company_id, s.cik
        UNION ALL
        SELECT r.candidate_id,
               r.selected_company_id,
               'OFFICIAL_REVIEW'::VARCHAR AS provider,
               r.selected_company_id AS provider_identifier,
               json_extract_string(r.local_entity, '$.preferredName') AS suggested_name,
               json_extract_string(r.local_entity, '$.country') AS suggested_country
        FROM review_decisions_temp r
        WHERE r.review_decision = 'accepted'
          AND r.local_entity IS NOT NULL
        """
    )
    unresolved_reviews = connection.execute(
        """
        SELECT count(*) FROM review_decisions_temp r
        LEFT JOIN review_selected_catalog_temp c USING (candidate_id)
        WHERE r.review_decision = 'accepted' AND c.candidate_id IS NULL
        """
    ).fetchone()[0]
    if unresolved_reviews:
        raise SilverError(
            f"Review file contains {unresolved_reviews} unknown selected companies"
        )
    connection.execute(
        """
        CREATE TEMP TABLE entity_suggestions_all_temp AS
        SELECT candidate_id,
               suggested_company_id,
               provider,
               provider_identifier,
               suggested_name,
               suggested_country,
               match_method,
               similarity_score,
               suggestion_rank,
               base_decision,
               base_reason
        FROM entity_suggestions_base_temp
        UNION ALL
        SELECT c.candidate_id,
               c.selected_company_id,
               c.provider,
               c.provider_identifier,
               c.suggested_name,
               c.suggested_country,
               'human_selected'::VARCHAR,
               NULL::DOUBLE,
               0::INTEGER,
               'needs_review'::VARCHAR,
               'human_selected_outside_suggestions'::VARCHAR
        FROM review_selected_catalog_temp c
        WHERE NOT EXISTS (
          SELECT 1 FROM entity_suggestions_base_temp b
          WHERE b.candidate_id = c.candidate_id
            AND b.suggested_company_id = c.selected_company_id
        )
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE entity_matches_temp AS
        SELECT 'em_' || substr(sha256(
                 s.candidate_id || '|' ||
                 coalesce(s.suggested_company_id, 'none') || '|' ||
                 s.suggestion_rank::VARCHAR
               ), 1, 32) AS entity_match_id,
               s.candidate_id,
               s.suggested_company_id,
               s.provider,
               s.provider_identifier,
               s.suggested_name,
               c.country AS candidate_country,
               s.suggested_country,
               s.match_method,
               s.similarity_score,
               s.suggestion_rank,
               CASE WHEN r.review_decision = 'accepted'
                           AND s.suggested_company_id = r.selected_company_id
                       THEN CASE WHEN r.review_method IN (
                                      'strong_official_evidence',
                                      'strong_official_identifier'
                                    )
                                 THEN 'evidence_accepted'
                                 ELSE 'human_accepted' END
                     WHEN r.review_decision = 'accepted'
                       THEN CASE WHEN r.review_method IN (
                                      'strong_official_evidence',
                                      'strong_official_identifier'
                                    )
                                 THEN 'evidence_rejected'
                                 ELSE 'human_rejected' END
                     WHEN r.review_decision = 'rejected' THEN 'human_rejected'
                     WHEN r.review_decision = 'unmatched' THEN 'human_unmatched'
                     WHEN r.review_decision IS NOT NULL
                       THEN 'review_' || r.review_decision
                     ELSE s.base_decision END AS decision,
               CASE WHEN r.review_decision IS NOT NULL
                      THEN CASE WHEN r.review_method IN (
                                       'strong_official_evidence',
                                       'strong_official_identifier'
                                     )
                                 THEN 'evidence_review:' || r.review_decision
                                 ELSE 'human_review:' || r.review_decision END
                    ELSE s.base_reason END AS decision_reason,
               CASE WHEN r.review_decision = 'accepted'
                          AND s.suggested_company_id = r.selected_company_id THEN TRUE
                    WHEN r.review_decision IS NOT NULL THEN FALSE
                    ELSE s.base_decision = 'auto_accepted' END AS is_accepted,
               r.reviewer,
               r.reviewer_note,
               {_sql_literal(rules['ruleVersion'])}::VARCHAR AS rule_version
        FROM entity_suggestions_all_temp s
        JOIN company_candidates_temp c USING (candidate_id)
        LEFT JOIN review_decisions_temp r USING (candidate_id)
        """
    )


if __name__ == "__main__":
    main()
