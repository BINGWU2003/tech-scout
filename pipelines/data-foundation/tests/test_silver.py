from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import duckdb
import pytest
import yaml

from data_foundation.datasets.silver import SilverError, build_silver, verify_silver


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def _copy_table(
    connection: duckdb.DuckDBPyConnection, table: str, path: Path
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection.execute(f"COPY {table} TO '{path.as_posix()}' (FORMAT PARQUET)")


def _bronze_fixture(tmp_path: Path) -> tuple[Path, Path]:
    data_root = tmp_path / "data"
    bronze_root = data_root / "bronze" / "bronze-fixture-v1"
    bronze_root.mkdir(parents=True)
    connection = duckdb.connect(":memory:")
    lineage = """
      _source_release VARCHAR,
      _source_path VARCHAR,
      _source_sha256 VARCHAR,
      _source_row_number BIGINT
    """
    connection.execute(
        f"""
        CREATE TABLE patents (
          patent_id VARCHAR, patent_type VARCHAR, patent_date VARCHAR,
          patent_title VARCHAR, wipo_kind VARCHAR, num_claims VARCHAR,
          withdrawn VARCHAR, filename VARCHAR, {lineage}
        )
        """
    )
    patent_rows = [
        ("p1", "utility", "2021-01-01", "Neural network accelerator chip"),
        ("p2", "utility", "2022-01-01", "Neuromorphic edge inference device"),
        ("p3", "utility", "2023-01-01", "Machine vision defect inspection"),
        ("p4", "utility", "2023-02-01", "Medical machine vision inspection"),
        ("p5", "utility", "2024-01-01", "Ordinary computation method"),
        (
            "p6",
            "utility",
            "2025-01-01",
            "Neural network machine vision inspection system",
        ),
        ("p7", "utility", "2018-01-01", "Neural network accelerator chip"),
    ]
    connection.executemany(
        "INSERT INTO patents VALUES (?, ?, ?, ?, 'A1', '10', 'false', ?, "
        "'bronze-fixture-v1', 'patents.tsv', ?, ?)",
        [
            (*row, f"{row[0]}.xml", "a" * 64, index)
            for index, row in enumerate(patent_rows, start=1)
        ],
    )
    connection.execute(
        f"""
        CREATE TABLE cpc (
          patent_id VARCHAR, cpc_sequence VARCHAR,
          cpc_version_indicator VARCHAR, cpc_section VARCHAR,
          cpc_class VARCHAR, cpc_subclass VARCHAR, cpc_group VARCHAR,
          cpc_type VARCHAR, cpc_action_date VARCHAR, {lineage}
        )
        """
    )
    cpc_rows = [
        ("p1", "G06N3/063"),
        ("p2", "G06N20/00"),
        ("p3", "G06V10/00"),
        ("p4", "G06V10/00"),
        ("p5", "G06N3/063"),
        ("p6", "G06N3/063"),
        ("p6", "G06V10/00"),
        ("p7", "G06N3/063"),
    ]
    connection.executemany(
        "INSERT INTO cpc VALUES (?, ?, '2024', 'G', 'G06', 'G06N', ?, "
        "'inventive', '2024-01-01', 'bronze-fixture-v1', 'cpc.tsv', ?, ?)",
        [
            (patent_id, str(index), group, "b" * 64, index)
            for index, (patent_id, group) in enumerate(cpc_rows, start=1)
        ],
    )
    connection.execute(
        f"""
        CREATE TABLE annual (
          patent_number VARCHAR, grant_year VARCHAR, assignee VARCHAR,
          assignee_sequence VARCHAR, assignee_ind VARCHAR, country VARCHAR,
          city VARCHAR, state VARCHAR, {lineage}
        )
        """
    )
    annual_rows = [
        ("p1", "2021", "Alpha Corp", "US"),
        ("p2", "2022", "Beta Inc", "US"),
        ("p3", "2023", "Gamma Visoin LLC", "US"),
        ("p6", "2025", "Delta Ltd", None),
        ("p6", "2025", "Epsilon Labs", "US"),
    ]
    connection.executemany(
        "INSERT INTO annual VALUES (?, ?, ?, '1', 'false', ?, 'Test City', "
        "'CA', 'bronze-fixture-v1', 'annual.csv', ?, ?)",
        [
            (*row, "c" * 64, index)
            for index, row in enumerate(annual_rows, start=1)
        ],
    )
    alias_columns = [
        '"Entity.OtherEntityNames.OtherEntityName.1" VARCHAR',
        '"Entity.OtherEntityNames.OtherEntityName.2" VARCHAR',
        '"Entity.OtherEntityNames.OtherEntityName.3" VARCHAR',
        '"Entity.OtherEntityNames.OtherEntityName.4" VARCHAR',
        '"Entity.OtherEntityNames.OtherEntityName.5" VARCHAR',
        (
            '"Entity.TransliteratedOtherEntityNames.'
            'TransliteratedOtherEntityName.1" VARCHAR'
        ),
        (
            '"Entity.TransliteratedOtherEntityNames.'
            'TransliteratedOtherEntityName.2" VARCHAR'
        ),
        (
            '"Entity.TransliteratedOtherEntityNames.'
            'TransliteratedOtherEntityName.3" VARCHAR'
        ),
        (
            '"Entity.TransliteratedOtherEntityNames.'
            'TransliteratedOtherEntityName.4" VARCHAR'
        ),
        (
            '"Entity.TransliteratedOtherEntityNames.'
            'TransliteratedOtherEntityName.5" VARCHAR'
        ),
    ]
    connection.execute(
        f"""
        CREATE TABLE entities (
          LEI VARCHAR, "Entity.LegalName" VARCHAR,
          {', '.join(alias_columns)},
          "Entity.LegalAddress.Country" VARCHAR,
          "Entity.HeadquartersAddress.Country" VARCHAR,
          "Entity.EntityStatus" VARCHAR, {lineage}
        )
        """
    )
    leis = {
        "alpha": "A" * 20,
        "gamma": "G" * 20,
    }
    connection.executemany(
        "INSERT INTO entities VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, "
        "NULL, NULL, NULL, NULL, NULL, 'US', 'US', 'ACTIVE', "
        "'bronze-fixture-v1', 'entities.csv', ?, ?)",
        [
            (leis["alpha"], "Alpha Corporation", "d" * 64, 1),
            (leis["gamma"], "Gamma Vision LLC", "d" * 64, 2),
        ],
    )
    connection.execute(
        f"""
        CREATE TABLE relationships (
          "Relationship.StartNode.NodeID" VARCHAR,
          "Relationship.EndNode.NodeID" VARCHAR,
          "Relationship.RelationshipType" VARCHAR,
          "Relationship.RelationshipStatus" VARCHAR,
          "Relationship.Period.1.startDate" VARCHAR,
          "Relationship.Period.1.endDate" VARCHAR,
          "Relationship.Period.1.periodType" VARCHAR,
          {lineage}
        )
        """
    )
    connection.execute(
        "INSERT INTO relationships VALUES (?, ?, 'IS_DIRECTLY_CONSOLIDATED_BY', "
        "'ACTIVE', '2020-01-01', NULL, 'RELATIONSHIP_PERIOD', "
        "'bronze-fixture-v1', 'relationships.csv', ?, 1)",
        [leis["alpha"], leis["gamma"], "e" * 64],
    )
    connection.execute(
        f"""
        CREATE TABLE sec (
          cik VARCHAR, name VARCHAR, ticker VARCHAR, exchange VARCHAR, {lineage}
        )
        """
    )
    connection.execute(
        "INSERT INTO sec VALUES ('100', 'Beta Incorporated', 'BETA', 'NYSE', "
        "'bronze-fixture-v1', 'companies.json', ?, 1)",
        ["f" * 64],
    )
    outputs = [
        ("uspto-pvannual", "uspto/pvannual.parquet", "annual"),
        ("uspto-patent", "uspto/patent.parquet", "patents"),
        ("uspto-cpc-at-issue", "uspto/cpc_at_issue.parquet", "cpc"),
        ("gleif-entities", "gleif/entities.parquet", "entities"),
        ("gleif-relationships", "gleif/relationships.parquet", "relationships"),
        ("sec-companies", "sec/companies.parquet", "sec"),
    ]
    manifest_files = []
    for dataset, relative_path, table in outputs:
        path = bronze_root / relative_path
        _copy_table(connection, table, path)
        row_count = connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        column_count = len(connection.execute(f"DESCRIBE {table}").fetchall())
        manifest_files.append(
            {
                "dataset": dataset,
                "path": relative_path,
                "rowCount": row_count,
                "columnCount": column_count,
                "sizeBytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    connection.close()
    _write_json(bronze_root / "quality_report.json", {"status": "passed"})
    manifest = {
        "schemaVersion": "1.0.0",
        "release": "bronze-fixture-v1",
        "layer": "bronze",
        "fileCount": len(manifest_files),
        "totalRows": sum(file["rowCount"] for file in manifest_files),
        "totalSizeBytes": sum(file["sizeBytes"] for file in manifest_files),
        "files": manifest_files,
        "qualityReport": "quality_report.json",
    }
    manifest_path = bronze_root / "manifest.json"
    _write_json(manifest_path, manifest)
    rules = {
        "schemaVersion": "1.0.0",
        "ruleVersion": "fixture-v1",
        "releaseName": "ai-domains",
        "period": {"fromYear": 2019, "toYear": 2025},
        "scoring": {
            "exactCpc": 4,
            "broadCpc": 2,
            "strongTitle": 4,
            "generalTitle": 2,
            "threshold": 6,
        },
        "normalization": {
            "version": "fixture-v1",
            "companySuffixes": [
                "incorporated",
                "corporation",
                "corp",
                "inc",
                "llc",
                "ltd",
            ],
        },
        "matching": {
            "fuzzyThreshold": 0.94,
            "prefixLength": 4,
            "maxSuggestions": 5,
            "minimumHumanAcceptances": 1,
        },
        "duckdb": {
            "memoryLimit": "1GB",
            "threads": 1,
            "compression": "zstd",
            "rowGroupSize": 1000,
        },
        "qualityBaseline": {
            "domainCounts": {"ai": 3, "industrial": 2},
            "distinctPatents": 4,
            "crossDomainOverlap": 1,
            "minimumPerDomain": 1,
        },
        "domains": [
            {
                "id": "ai",
                "name": "AI chips",
                "exactCpcPrefixes": ["G06N3/063"],
                "broadCpcPrefixes": ["G06N"],
                "generalTitleTerms": ["neural network"],
                "strongTitleTerms": ["neuromorphic", "edge inference"],
                "exclusionTitleTerms": ["generic processor"],
            },
            {
                "id": "industrial",
                "name": "Industrial vision",
                "exactCpcPrefixes": [],
                "broadCpcPrefixes": ["G06V", "G06T", "B07C", "G01N"],
                "generalTitleTerms": [],
                "strongTitleTerms": ["machine vision", "defect inspection"],
                "exclusionTitleTerms": ["medical"],
            },
        ],
    }
    rules_path = tmp_path / "rules.yaml"
    rules_path.write_text(yaml.safe_dump(rules, sort_keys=False), encoding="utf-8")
    return manifest_path, rules_path


def test_builds_auditable_review_required_release(tmp_path: Path) -> None:
    bronze_manifest, rules = _bronze_fixture(tmp_path)
    manifest = build_silver(
        bronze_manifest_path=bronze_manifest,
        rules_path=rules,
        version="fixture-v1",
    )
    assert manifest["fileCount"] == 16
    assert manifest["status"] == "review_required"
    assert manifest["publishable"] is False
    release = tmp_path / "data/silver/ai-domains/fixture-v1"
    assert verify_silver(manifest_path=release / "manifest.json") == manifest
    evaluations_path = (release / "patent_domain_evaluations.parquet").as_posix()
    entity_matches_path = (release / "entity_matches.parquet").as_posix()
    company_relations_path = (release / "company_relations.parquet").as_posix()
    with duckdb.connect(":memory:") as connection:
        evaluations = connection.execute(
            f"""
            SELECT patent_id, domain_id, decision, decision_reason,
                   matched_cpcs, matched_strong_keywords,
                   matched_general_keywords, total_score
            FROM read_parquet('{evaluations_path}')
            ORDER BY patent_id, domain_id
            """
        ).fetchall()
        matches = connection.execute(
            f"""
            SELECT candidate_id, provider, match_method, decision, is_accepted
            FROM read_parquet('{entity_matches_path}')
            """
        ).fetchall()
        company_relations = connection.execute(
            f"SELECT count(*) FROM read_parquet('{company_relations_path}')"
        ).fetchone()[0]
    assert any(
        row[0] == "p4" and row[3] == "title_exclusion_term" for row in evaluations
    )
    assert any(
        row[0] == "p5" and row[3] == "score_below_threshold" for row in evaluations
    )
    assert any(row[2] == "gleif_exact_name_country" and row[4] for row in matches)
    assert any(
        row[2] == "sec_exact_name" and row[3] == "needs_review" for row in matches
    )
    assert any(row[2] == "gleif_fuzzy_name_country" for row in matches)
    assert any(row[2] == "missing_country" for row in matches)
    assert any(row[2] == "no_candidate" and row[3] == "unmatched" for row in matches)
    assert company_relations == 1
    with (release / "entity_review.csv").open(encoding="utf-8", newline="") as source:
        review_rows = list(csv.DictReader(source))
    assert len(review_rows) == 4


def test_human_review_creates_new_publishable_version(tmp_path: Path) -> None:
    bronze_manifest, rules = _bronze_fixture(tmp_path)
    first = build_silver(
        bronze_manifest_path=bronze_manifest,
        rules_path=rules,
        version="fixture-v1",
    )
    first_release = tmp_path / "data/silver/ai-domains/fixture-v1"
    candidate_path = (first_release / "company_candidates.parquet").as_posix()
    with duckdb.connect(":memory:") as connection:
        beta_candidate = connection.execute(
            f"""
            SELECT candidate_id
            FROM read_parquet('{candidate_path}')
            WHERE representative_name = 'Beta Inc'
            """
        ).fetchone()[0]
    review_file = tmp_path / "review.json"
    _write_json(
        review_file,
        {
            "schemaVersion": "1.0.0",
            "reviewer": "tester",
            "decisions": [
                {
                    "candidate_id": beta_candidate,
                    "decision": "accepted",
                    "selected_company_id": "company:sec:100",
                    "reviewer_note": "confirmed",
                }
            ],
        },
    )
    second = build_silver(
        bronze_manifest_path=bronze_manifest,
        rules_path=rules,
        version="fixture-v2",
        review_file_path=review_file,
    )
    assert first["publishable"] is False
    assert second["publishable"] is True
    assert second["status"] == "passed"
    second_release = tmp_path / "data/silver/ai-domains/fixture-v2"
    entity_matches_path = (second_release / "entity_matches.parquet").as_posix()
    with duckdb.connect(":memory:") as connection:
        accepted = connection.execute(
            f"""
            SELECT count(*) FROM read_parquet('{entity_matches_path}')
            WHERE decision = 'human_accepted' AND is_accepted
            """
        ).fetchone()[0]
    assert accepted == 1
    assert first_release.is_dir()


def test_official_evidence_creates_local_company_and_audit_outputs(
    tmp_path: Path,
) -> None:
    bronze_manifest, rules = _bronze_fixture(tmp_path)
    first = build_silver(
        bronze_manifest_path=bronze_manifest,
        rules_path=rules,
        version="fixture-v1",
    )
    first_release = tmp_path / "data/silver/ai-domains/fixture-v1"
    candidate_path = (first_release / "company_candidates.parquet").as_posix()
    with duckdb.connect(":memory:") as connection:
        beta_candidate = connection.execute(
            f"""
            SELECT candidate_id
            FROM read_parquet('{candidate_path}')
            WHERE representative_name = 'Beta Inc'
            """
        ).fetchone()[0]

    batch = tmp_path / "review-batch"
    batch.mkdir()
    queue = batch / "queue.jsonl"
    queue.write_text(
        json.dumps(
            {
                "candidateId": beta_candidate,
                "assigneeName": "Beta Inc",
                "country": "US",
                "patentCount": 1,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    evidence = batch / "evidence.jsonl"
    evidence.write_text(
        json.dumps(
            {
                "evidenceId": "ev-beta-registry",
                "candidateId": beta_candidate,
                "publisher": "Official Registry",
                "sourceType": "official_registry",
                "url": "https://registry.example/beta",
                "observedAt": "2026-09-02T10:00:00Z",
                "legalName": "Beta Incorporated",
                "country": "US",
                "identifierType": "registration_number",
                "identifierValue": "BETA-1",
                "preserved": True,
                "contentSha256": "d" * 64,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    decisions = batch / "decisions.json"
    _write_json(
        decisions,
        {
            "schemaVersion": "2.0.0",
            "sourceSilverRelease": "fixture-v1",
            "batchId": "batch-v1",
            "decisions": [
                {
                    "candidate_id": beta_candidate,
                    "decision": "accepted",
                    "organizationType": "company",
                    "reviewMethod": "strong_official_evidence",
                    "reviewedAt": "2026-09-02T10:05:00Z",
                    "selected_company_id": (
                        "company:registry:us:registration_number:beta-1"
                    ),
                    "evidenceIds": ["ev-beta-registry"],
                    "reviewer": "Codex evidence rule",
                    "reviewer_note": "Official registry identity.",
                    "localEntity": {
                        "companyId": (
                            "company:registry:us:registration_number:beta-1"
                        ),
                        "preferredName": "Beta Incorporated",
                        "legalName": "Beta Incorporated",
                        "country": "US",
                        "officialDomain": "beta.example",
                        "identifiers": [
                            {
                                "type": "registration_number",
                                "value": "BETA-1",
                                "provider": "Official Registry",
                            },
                            {
                                "type": "official_domain",
                                "value": "beta.example",
                                "provider": "Official Registry",
                            },
                        ],
                    },
                }
            ],
        },
    )
    batch_files = []
    for path, rows, file_format in (
        (queue, 1, "jsonl"),
        (evidence, 1, "jsonl"),
        (decisions, 1, "json"),
    ):
        batch_files.append(
            {
                "path": path.name,
                "format": file_format,
                "rowCount": rows,
                "sizeBytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    batch_manifest = batch / "manifest.json"
    _write_json(
        batch_manifest,
        {
            "schemaVersion": "1.0.0",
            "release": "batch-v1",
            "status": "passed",
            "sourceSilverRelease": "fixture-v1",
            "silverManifestPath": str(first_release / "manifest.json"),
            "silverManifestSha256": _sha256(first_release / "manifest.json"),
            "candidateCount": 1,
            "candidatePatentImpact": 1,
            "evidenceCount": 1,
            "decisionCount": 1,
            "decisionCounts": {"accepted": 1},
            "remainingActiveCandidates": 0,
            "files": batch_files,
        },
    )

    second = build_silver(
        bronze_manifest_path=bronze_manifest,
        rules_path=rules,
        version="fixture-v2",
        review_file_path=decisions,
        review_evidence_manifest_path=batch_manifest,
    )

    assert first["fileCount"] == 16
    assert second["fileCount"] == 16
    release = tmp_path / "data/silver/ai-domains/fixture-v2"
    with duckdb.connect(":memory:") as connection:
        local_company = connection.execute(
            "SELECT preferred_name, provider FROM read_parquet(?) "
            "WHERE company_id = ?",
            [
                str(release / "companies.parquet"),
                "company:registry:us:registration_number:beta-1",
            ],
        ).fetchone()
        relation_count = connection.execute(
            "SELECT count(*) FROM read_parquet(?) WHERE company_id = ?",
            [
                str(release / "company_patent_relations.parquet"),
                "company:registry:us:registration_number:beta-1",
            ],
        ).fetchone()[0]
        decision_count = connection.execute(
            "SELECT count(*) FROM read_parquet(?)",
            [str(release / "entity_review_decisions.parquet")],
        ).fetchone()[0]
        evidence_count = connection.execute(
            "SELECT count(*) FROM read_parquet(?)",
            [str(release / "entity_evidence.parquet")],
        ).fetchone()[0]
    assert local_company == ("Beta Incorporated", "OFFICIAL_REVIEW")
    assert relation_count == 1
    assert decision_count == 1
    assert evidence_count == 1
    with (release / "entity_review.csv").open(encoding="utf-8", newline="") as source:
        remaining = list(csv.DictReader(source))
    assert all(row["candidate_id"] != beta_candidate for row in remaining)
    assert verify_silver(manifest_path=release / "manifest.json") == second


def test_rejects_changed_inputs_and_output(tmp_path: Path) -> None:
    bronze_manifest, rules = _bronze_fixture(tmp_path)
    build_silver(
        bronze_manifest_path=bronze_manifest,
        rules_path=rules,
        version="fixture-v1",
    )
    release = tmp_path / "data/silver/ai-domains/fixture-v1"
    original_rules = rules.read_text(encoding="utf-8")
    rules.write_text(original_rules + "\n", encoding="utf-8")
    with pytest.raises(SilverError, match="different inputs"):
        build_silver(
            bronze_manifest_path=bronze_manifest,
            rules_path=rules,
            version="fixture-v1",
        )
    rules.write_text(original_rules, encoding="utf-8")
    output = release / "patents.parquet"
    output.write_bytes(output.read_bytes() + b"changed")
    with pytest.raises(SilverError, match="size mismatch"):
        verify_silver(manifest_path=release / "manifest.json")
