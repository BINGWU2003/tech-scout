from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import duckdb
import pytest

from intelligence.datasets.entity_review import (
    EntityReviewError,
    prepare_entity_review,
    verify_entity_review,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_parquet(path: Path, query: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect(":memory:") as connection:
        connection.execute(f"COPY ({query}) TO '{path.as_posix()}' (FORMAT PARQUET)")


def _silver_fixture(tmp_path: Path) -> Path:
    release = tmp_path / "data/silver/ai-domains/2026-09-v2"
    release.mkdir(parents=True)
    review_path = release / "entity_review.csv"
    with review_path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(
            target,
            fieldnames=[
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
            ],
        )
        writer.writeheader()
        writer.writerows(
            [
                {
                    "candidate_id": "c-review",
                    "assignee_name": "Review Corp",
                    "name_normalized": "review",
                    "country": "US",
                    "patent_count": "2",
                    "party_row_count": "2",
                    "status": "needs_review",
                    "best_match_method": "sec_exact_name",
                    "best_confidence": "",
                    "best_candidate_company_id": "company:sec:1",
                    "best_candidate_name": "Review Corp",
                    "suggestions_json": '[{"company_id":"company:sec:1"}]',
                    "decision": "",
                    "selected_company_id": "",
                    "reviewer": "",
                    "reviewer_note": "",
                },
                {
                    "candidate_id": "c-high",
                    "assignee_name": "High Labs",
                    "name_normalized": "high labs",
                    "country": "GB",
                    "patent_count": "5",
                    "party_row_count": "5",
                    "status": "unmatched",
                    "best_match_method": "no_candidate",
                    "best_confidence": "",
                    "best_candidate_company_id": "",
                    "best_candidate_name": "",
                    "suggestions_json": "[]",
                    "decision": "",
                    "selected_company_id": "",
                    "reviewer": "",
                    "reviewer_note": "",
                },
                {
                    "candidate_id": "c-low",
                    "assignee_name": "Low LLC",
                    "name_normalized": "low",
                    "country": "US",
                    "patent_count": "4",
                    "party_row_count": "4",
                    "status": "unmatched",
                    "best_match_method": "no_candidate",
                    "best_confidence": "",
                    "best_candidate_company_id": "",
                    "best_candidate_name": "",
                    "suggestions_json": "[]",
                    "decision": "",
                    "selected_company_id": "",
                    "reviewer": "",
                    "reviewer_note": "",
                },
            ]
        )

    candidates = release / "company_candidates.parquet"
    _write_parquet(
        candidates,
        """
        SELECT * FROM (VALUES
          ('c-review', 'Review Corp', 'review', 'US', 2, 2, 1, 'p1'),
          ('c-high', 'High Labs', 'high labs', 'GB', 5, 5, 1, 'p2'),
          ('c-low', 'Low LLC', 'low', 'US', 4, 4, 1, 'p3')
        ) AS t(candidate_id, representative_name, name_normalized, country,
               patent_count, party_row_count, raw_name_variant_count,
               first_patent_id)
        """,
    )
    parties = release / "patent_parties.parquet"
    _write_parquet(
        parties,
        """
        SELECT * FROM (VALUES
          ('pp1', 'p1', 'assignee', 'Review Corp', 'review', 'US', 'Austin',
           'TX', 1, false),
          ('pp2', 'p2', 'assignee', 'High Labs Ltd', 'high labs', 'GB',
           'London', NULL, 1, false)
        ) AS t(patent_party_id, patent_id, party_role, party_name,
               party_name_normalized, country, city, region, party_sequence,
               is_individual)
        """,
    )
    patents = release / "patents.parquet"
    _write_parquet(
        patents,
        """
        SELECT * FROM (VALUES
          ('p1', DATE '2024-01-01', 'Review accelerator'),
          ('p2', DATE '2025-02-02', 'High inference chip')
        ) AS t(patent_id, patent_date, patent_title)
        """,
    )
    files = []
    for path, rows in (
        (review_path, 3),
        (candidates, 3),
        (parties, 2),
        (patents, 2),
    ):
        files.append(
            {
                "path": path.name,
                "rowCount": rows,
                "sizeBytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    manifest = release / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schemaVersion": "1.0.0",
                "release": "2026-09-v2",
                "status": "passed",
                "publishable": True,
                "files": files,
            }
        ),
        encoding="utf-8",
    )
    return manifest


def test_prepares_and_verifies_high_impact_review_batch(tmp_path: Path) -> None:
    silver_manifest = _silver_fixture(tmp_path)
    output = tmp_path / "reviews/ai-domains/2026-09-b1"

    manifest = prepare_entity_review(
        silver_manifest_path=silver_manifest,
        version="2026-09-b1",
        output_root=output,
        unmatched_min_patents=5,
        expected_candidates=2,
        expected_impact=7,
    )

    assert manifest["status"] == "prepared"
    assert manifest["candidateCount"] == 2
    assert manifest["candidatePatentImpact"] == 7
    queue = [
        json.loads(line)
        for line in (output / "queue.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [row["candidateId"] for row in queue] == ["c-high", "c-review"]
    assert queue[0]["patents"] == [
        {
            "patentDate": "2025-02-02",
            "patentId": "p2",
            "title": "High inference chip",
        }
    ]
    assert queue[1]["locations"] == [
        {"city": "Austin", "country": "US", "region": "TX"}
    ]
    assert verify_entity_review(output / "manifest.json") == manifest
    assert (
        prepare_entity_review(
            silver_manifest_path=silver_manifest,
            version="2026-09-b1",
            output_root=output,
            unmatched_min_patents=5,
            expected_candidates=2,
            expected_impact=7,
        )
        == manifest
    )


def test_review_verification_rejects_tampered_queue(tmp_path: Path) -> None:
    silver_manifest = _silver_fixture(tmp_path)
    output = tmp_path / "reviews/ai-domains/2026-09-b1"
    prepare_entity_review(
        silver_manifest_path=silver_manifest,
        version="2026-09-b1",
        output_root=output,
        unmatched_min_patents=5,
    )
    with (output / "queue.jsonl").open("a", encoding="utf-8") as target:
        target.write("{}\n")
    with pytest.raises(EntityReviewError, match="size mismatch"):
        verify_entity_review(output / "manifest.json")


def test_finalizes_terminal_evidence_backed_decisions(tmp_path: Path) -> None:
    silver_manifest = _silver_fixture(tmp_path)
    evidence = tmp_path / "evidence.jsonl"
    evidence.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "evidenceId": "ev-high-registry",
                        "candidateId": "c-high",
                        "publisher": "Companies House",
                        "sourceType": "official_registry",
                        "url": "https://find-and-update.company-information.service.gov.uk/company/1",
                        "observedAt": "2026-09-02T10:00:00Z",
                        "legalName": "High Labs Limited",
                        "country": "GB",
                        "identifierType": "company_number",
                        "identifierValue": "1",
                        "preserved": True,
                        "contentSha256": "a" * 64,
                    }
                ),
                json.dumps(
                    {
                        "evidenceId": "ev-review-ror",
                        "candidateId": "c-review",
                        "publisher": "ROR",
                        "sourceType": "ror",
                        "url": "https://ror.org/01example",
                        "observedAt": "2026-09-02T10:01:00Z",
                        "legalName": "Review Research Institute",
                        "country": "US",
                        "identifierType": "ror",
                        "identifierValue": "01example",
                        "preserved": True,
                        "contentSha256": "b" * 64,
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    decisions = tmp_path / "decisions.json"
    decisions.write_text(
        json.dumps(
            {
                "schemaVersion": "2.0.0",
                "sourceSilverRelease": "2026-09-v2",
                "batchId": "2026-09-b1",
                "decisions": [
                    {
                        "candidate_id": "c-high",
                        "decision": "accepted",
                        "organizationType": "company",
                        "reviewMethod": "strong_official_evidence",
                        "reviewedAt": "2026-09-02T10:05:00Z",
                        "selected_company_id": "company:registry:gb:company_number:1",
                        "evidenceIds": ["ev-high-registry"],
                        "reviewer": "Codex evidence rule",
                        "reviewer_note": "Official registry identity.",
                        "localEntity": {
                            "companyId": "company:registry:gb:company_number:1",
                            "preferredName": "High Labs Limited",
                            "legalName": "High Labs Limited",
                            "country": "GB",
                            "officialDomain": "high.example",
                            "identifiers": [
                                {
                                    "type": "company_number",
                                    "value": "1",
                                    "provider": "Companies House",
                                }
                            ],
                        },
                    },
                    {
                        "candidate_id": "c-review",
                        "decision": "non_company",
                        "organizationType": "research_institute",
                        "reviewMethod": "strong_official_evidence",
                        "reviewedAt": "2026-09-02T10:06:00Z",
                        "selected_company_id": None,
                        "evidenceIds": ["ev-review-ror"],
                        "reviewer": "Codex evidence rule",
                        "reviewer_note": "ROR identifies a research institute.",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "reviews/ai-domains/2026-09-b1"

    manifest = prepare_entity_review(
        silver_manifest_path=silver_manifest,
        version="2026-09-b1",
        output_root=output,
        unmatched_min_patents=5,
        expected_candidates=2,
        expected_impact=7,
        evidence_file=evidence,
        decisions_file=decisions,
    )

    assert manifest["status"] == "passed"
    assert manifest["evidenceCount"] == 2
    assert manifest["decisionCount"] == 2
    assert manifest["decisionCounts"] == {"accepted": 1, "non_company": 1}
    assert manifest["remainingActiveCandidates"] == 0
    assert next(
        row for row in manifest["files"] if row["path"] == "evidence.jsonl"
    )["rowCount"] == 2
    assert verify_entity_review(output / "manifest.json") == manifest


def test_finalization_rejects_unreviewed_candidate(tmp_path: Path) -> None:
    silver_manifest = _silver_fixture(tmp_path)
    evidence = tmp_path / "evidence.jsonl"
    evidence.write_text(
        json.dumps(
            {
                "evidenceId": "ev-high",
                "candidateId": "c-high",
                "publisher": "Official",
                "sourceType": "official_registry",
                "url": "https://example.invalid/high",
                "observedAt": "2026-09-02T10:00:00Z",
                "legalName": "High Labs",
                "country": "GB",
                "identifierType": "company_number",
                "identifierValue": "1",
                "preserved": True,
                "contentSha256": "a" * 64,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    decisions = tmp_path / "decisions.json"
    decisions.write_text(
        json.dumps(
            {
                "schemaVersion": "2.0.0",
                "sourceSilverRelease": "2026-09-v2",
                "batchId": "2026-09-b1",
                "decisions": [
                    {
                        "candidate_id": "c-high",
                        "decision": "verified_unmatched",
                        "organizationType": "company",
                        "reviewMethod": "strong_official_evidence",
                        "reviewedAt": "2026-09-02T10:05:00Z",
                        "selected_company_id": None,
                        "evidenceIds": ["ev-high"],
                        "reviewer": "Codex evidence rule",
                        "reviewer_note": "No catalog mapping.",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(EntityReviewError, match="missing terminal decisions"):
        prepare_entity_review(
            silver_manifest_path=silver_manifest,
            version="2026-09-b1",
            output_root=tmp_path / "final",
            unmatched_min_patents=5,
            evidence_file=evidence,
            decisions_file=decisions,
        )


def test_finalization_rejects_accepted_without_strong_evidence(tmp_path: Path) -> None:
    silver_manifest = _silver_fixture(tmp_path)
    evidence = tmp_path / "evidence.jsonl"
    evidence.write_text(
        json.dumps(
            {
                "evidenceId": "ev-high-website",
                "candidateId": "c-high",
                "publisher": "High Labs",
                "sourceType": "official_company_site",
                "url": "https://high.example/about",
                "observedAt": "2026-09-02T10:00:00Z",
                "legalName": "High Labs Limited",
                "country": "GB",
                "preserved": True,
                "contentSha256": "a" * 64,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    decisions = tmp_path / "decisions.json"
    decisions.write_text(
        json.dumps(
            {
                "schemaVersion": "2.0.0",
                "sourceSilverRelease": "2026-09-v2",
                "batchId": "2026-09-b1",
                "decisions": [
                    {
                        "candidate_id": "c-high",
                        "decision": "accepted",
                        "organizationType": "company",
                        "reviewMethod": "strong_official_evidence",
                        "reviewedAt": "2026-09-02T10:05:00Z",
                        "selected_company_id": "company:local:high",
                        "evidenceIds": ["ev-high-website"],
                        "reviewer": "Codex evidence rule",
                        "reviewer_note": "A website alone is not sufficient.",
                        "localEntity": {
                            "companyId": "company:local:high",
                            "preferredName": "High Labs Limited",
                            "legalName": "High Labs Limited",
                            "country": "GB",
                        },
                    },
                    {
                        "candidate_id": "c-review",
                        "decision": "insufficient_evidence",
                        "organizationType": "unknown",
                        "reviewMethod": "official_sources_exhausted",
                        "reviewedAt": "2026-09-02T10:06:00Z",
                        "selected_company_id": None,
                        "evidenceIds": ["ev-review-source"],
                        "reviewer": "Codex evidence rule",
                        "reviewer_note": "No reliable identity mapping.",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    with evidence.open("a", encoding="utf-8") as target:
        target.write(
            json.dumps(
                {
                    "evidenceId": "ev-review-source",
                    "candidateId": "c-review",
                    "publisher": "USPTO",
                    "sourceType": "official_bulk_data",
                    "url": "https://data.uspto.gov/bulkdata/datasets",
                    "observedAt": "2026-09-02T10:00:00Z",
                    "preserved": True,
                    "contentSha256": "b" * 64,
                }
            )
            + "\n"
        )

    with pytest.raises(EntityReviewError, match="strong official evidence"):
        prepare_entity_review(
            silver_manifest_path=silver_manifest,
            version="2026-09-b1",
            output_root=tmp_path / "final",
            unmatched_min_patents=5,
            evidence_file=evidence,
            decisions_file=decisions,
        )


def test_final_review_preserves_and_verifies_source_artifacts(tmp_path: Path) -> None:
    silver_manifest = _silver_fixture(tmp_path)
    artifacts = tmp_path / "source-artifacts"
    artifacts.mkdir()
    registry_artifact = artifacts / "registry.json"
    registry_artifact.write_text('{"company":"High Labs Limited"}\n')
    uspto_artifact = artifacts / "uspto.json"
    uspto_artifact.write_text('{"assignee":"Review Research Institute"}\n')
    evidence = tmp_path / "evidence.jsonl"
    evidence.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "evidenceId": "ev-high-registry",
                        "candidateId": "c-high",
                        "publisher": "Companies House",
                        "sourceType": "official_registry",
                        "url": "https://example.invalid/registry/1",
                        "observedAt": "2026-09-02T10:00:00Z",
                        "legalName": "High Labs Limited",
                        "country": "GB",
                        "identifierType": "company_number",
                        "identifierValue": "1",
                        "preserved": True,
                        "contentSha256": _sha256(registry_artifact),
                        "artifactPath": "registry.json",
                    }
                ),
                json.dumps(
                    {
                        "evidenceId": "ev-review-uspto",
                        "candidateId": "c-review",
                        "publisher": "USPTO",
                        "sourceType": "official_bulk_data",
                        "url": "https://data.uspto.gov/bulkdata/datasets",
                        "observedAt": "2026-09-02T10:01:00Z",
                        "legalName": "Review Research Institute",
                        "country": "US",
                        "preserved": True,
                        "contentSha256": _sha256(uspto_artifact),
                        "artifactPath": "uspto.json",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    decisions = tmp_path / "decisions.json"
    decisions.write_text(
        json.dumps(
            {
                "schemaVersion": "2.0.0",
                "sourceSilverRelease": "2026-09-v2",
                "batchId": "2026-09-b1",
                "decisions": [
                    {
                        "candidate_id": "c-high",
                        "decision": "accepted",
                        "organizationType": "company",
                        "reviewMethod": "strong_official_identifier",
                        "reviewedAt": "2026-09-02T10:05:00Z",
                        "selected_company_id": "company:registry:gb:company_number:1",
                        "evidenceIds": ["ev-high-registry"],
                        "reviewer": "Codex evidence rule",
                        "reviewer_note": "Official registry identity.",
                        "localEntity": {
                            "companyId": "company:registry:gb:company_number:1",
                            "preferredName": "High Labs Limited",
                            "legalName": "High Labs Limited",
                            "country": "GB",
                        },
                    },
                    {
                        "candidate_id": "c-review",
                        "decision": "insufficient_evidence",
                        "organizationType": "research_institute",
                        "reviewMethod": "official_sources_insufficient",
                        "reviewedAt": "2026-09-02T10:06:00Z",
                        "selected_company_id": None,
                        "evidenceIds": ["ev-review-uspto"],
                        "reviewer": "Codex evidence rule",
                        "reviewer_note": "No stable identity mapping.",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    release = tmp_path / "reviews/ai-domains/2026-09-b1"

    manifest = prepare_entity_review(
        silver_manifest_path=silver_manifest,
        version="2026-09-b1",
        output_root=release,
        unmatched_min_patents=5,
        evidence_file=evidence,
        decisions_file=decisions,
        evidence_artifacts_dir=artifacts,
    )

    artifact_paths = {
        row["path"]
        for row in manifest["files"]
        if row.get("role") == "evidence_artifact"
    }
    assert artifact_paths == {
        "evidence-artifacts/registry.json",
        "evidence-artifacts/uspto.json",
    }
    preserved = [
        json.loads(line)
        for line in (release / "evidence.jsonl").read_text().splitlines()
    ]
    assert {row["artifactPath"] for row in preserved} == artifact_paths
    (release / "evidence-artifacts/registry.json").write_text("tampered")
    with pytest.raises(EntityReviewError, match="size mismatch"):
        verify_entity_review(release / "manifest.json")
