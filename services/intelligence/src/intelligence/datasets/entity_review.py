"""Prepare and verify deterministic entity-review batches."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import mimetypes
import os
import shutil
import tempfile
from datetime import UTC, date, datetime
from pathlib import Path, PurePosixPath
from typing import Any

import duckdb


class EntityReviewError(RuntimeError):
    """Raised when an entity-review release is invalid."""


TERMINAL_DECISIONS = {
    "accepted",
    "rejected",
    "verified_unmatched",
    "non_company",
    "insufficient_evidence",
}
ORGANIZATION_TYPES = {
    "company",
    "university",
    "research_institute",
    "government",
    "individual",
    "other_non_company",
    "unknown",
}
STABLE_IDENTIFIER_TYPES = {
    "cik",
    "company_number",
    "lei",
    "registration_number",
    "ror",
}
OFFICIAL_EVIDENCE_TYPES = {
    "gleif",
    "official_company_site",
    "official_registry",
    "regulatory_filing",
    "ror",
    "sec",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EntityReviewError(f"Unable to read JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise EntityReviewError(f"Expected a JSON object in {path}")
    return value


def _write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _manifest_file(manifest: dict[str, Any], name: str) -> dict[str, Any]:
    matches = [
        entry for entry in manifest.get("files", []) if entry.get("path") == name
    ]
    if len(matches) != 1:
        raise EntityReviewError(f"Silver manifest must register exactly one {name}")
    return matches[0]


def _verify_registered_file(root: Path, entry: dict[str, Any]) -> Path:
    path = root / str(entry.get("path", ""))
    if not path.is_file():
        raise EntityReviewError(f"Registered file is missing: {path}")
    size = path.stat().st_size
    if size != int(entry.get("sizeBytes", -1)):
        raise EntityReviewError(f"File size mismatch: {path}")
    if _sha256(path) != entry.get("sha256"):
        raise EntityReviewError(f"File SHA-256 mismatch: {path}")
    return path


def _load_candidates(
    path: Path, unmatched_min_patents: int
) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    selected: list[dict[str, Any]] = []
    for row in rows:
        try:
            patent_count = int(row.get("patent_count", ""))
        except ValueError as error:
            raise EntityReviewError(
                f"Invalid patent_count for {row.get('candidate_id')}"
            ) from error
        status = str(row.get("status", ""))
        if status == "needs_review" or (
            status == "unmatched" and patent_count >= unmatched_min_patents
        ):
            suggestions_raw = row.get("suggestions_json") or "[]"
            try:
                suggestions = json.loads(suggestions_raw)
            except json.JSONDecodeError as error:
                raise EntityReviewError(
                    f"Invalid suggestions_json for {row.get('candidate_id')}"
                ) from error
            selected.append(
                {
                    "candidateId": row.get("candidate_id"),
                    "assigneeName": row.get("assignee_name"),
                    "normalizedName": row.get("name_normalized"),
                    "country": row.get("country") or None,
                    "patentCount": patent_count,
                    "partyRowCount": int(row.get("party_row_count", "0")),
                    "status": status,
                    "bestMatchMethod": row.get("best_match_method") or None,
                    "bestConfidence": (
                        float(row["best_confidence"])
                        if row.get("best_confidence")
                        else None
                    ),
                    "bestCandidateCompanyId": (
                        row.get("best_candidate_company_id") or None
                    ),
                    "bestCandidateName": row.get("best_candidate_name") or None,
                    "suggestions": suggestions,
                }
            )
    return sorted(selected, key=lambda row: (-row["patentCount"], row["candidateId"]))


def _as_iso(value: date | str | None) -> str | None:
    return value.isoformat() if isinstance(value, date) else value


def _add_context(
    candidates: list[dict[str, Any]], parties_path: Path, patents_path: Path
) -> None:
    with duckdb.connect(":memory:") as connection:
        connection.read_parquet(str(parties_path)).create_view("parties")
        connection.read_parquet(str(patents_path)).create_view("patents")
        for candidate in candidates:
            parameters = [candidate["normalizedName"], candidate["country"]]
            variants = connection.execute(
                """
                SELECT DISTINCT party_name
                FROM parties
                WHERE party_name_normalized = ?
                  AND country IS NOT DISTINCT FROM ?
                ORDER BY party_name
                """,
                parameters,
            ).fetchall()
            locations = connection.execute(
                """
                SELECT DISTINCT country, city, region
                FROM parties
                WHERE party_name_normalized = ?
                  AND country IS NOT DISTINCT FROM ?
                  AND (country IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL)
                ORDER BY country NULLS LAST, city NULLS LAST, region NULLS LAST
                """,
                parameters,
            ).fetchall()
            patents = connection.execute(
                """
                SELECT DISTINCT p.patent_id, p.patent_date, p.patent_title
                FROM parties pp
                JOIN patents p USING (patent_id)
                WHERE pp.party_name_normalized = ?
                  AND pp.country IS NOT DISTINCT FROM ?
                ORDER BY p.patent_date DESC NULLS LAST, p.patent_id
                """,
                parameters,
            ).fetchall()
            candidate["rawNameVariants"] = [row[0] for row in variants]
            candidate["locations"] = [
                {"country": row[0], "city": row[1], "region": row[2]}
                for row in locations
            ]
            candidate["patents"] = [
                {
                    "patentId": row[0],
                    "patentDate": _as_iso(row[1]),
                    "title": row[2],
                }
                for row in patents
            ]


def _file_entry(path: Path, row_count: int, file_format: str) -> dict[str, Any]:
    return {
        "path": path.name,
        "format": file_format,
        "rowCount": row_count,
        "sizeBytes": path.stat().st_size,
        "sha256": _sha256(path),
    }


def _artifact_inputs(
    evidence: list[dict[str, Any]], artifacts_dir: Path | None
) -> tuple[list[dict[str, Any]], list[tuple[Path, PurePosixPath]]]:
    referenced = [row for row in evidence if row.get("artifactPath")]
    if not referenced:
        if artifacts_dir is not None:
            raise EntityReviewError("Evidence artifacts were supplied but not referenced")
        return evidence, []
    if artifacts_dir is None:
        raise EntityReviewError("Evidence artifactPath requires --evidence-artifacts")
    root = artifacts_dir.resolve()
    if not root.is_dir():
        raise EntityReviewError(f"Evidence artifacts directory is missing: {root}")
    transformed = [dict(row) for row in evidence]
    inputs: dict[PurePosixPath, Path] = {}
    for row in transformed:
        raw_path = row.get("artifactPath")
        if not raw_path:
            continue
        relative = PurePosixPath(str(raw_path).replace("\\", "/"))
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise EntityReviewError(f"Invalid evidence artifactPath: {raw_path}")
        source = (root / Path(*relative.parts)).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise EntityReviewError(f"Evidence artifact is missing: {raw_path}")
        if _sha256(source) != row.get("contentSha256"):
            raise EntityReviewError(f"Evidence artifact SHA-256 mismatch: {raw_path}")
        existing = inputs.get(relative)
        if existing is not None and existing != source:
            raise EntityReviewError(f"Duplicate evidence artifactPath: {raw_path}")
        inputs[relative] = source
        row["artifactPath"] = f"evidence-artifacts/{relative.as_posix()}"
    return transformed, sorted(inputs.items(), key=lambda item: item[0].as_posix())


def _artifact_file_entry(path: Path, relative: PurePosixPath) -> dict[str, Any]:
    media_type = mimetypes.guess_type(relative.name)[0] or "application/octet-stream"
    return {
        "path": f"evidence-artifacts/{relative.as_posix()}",
        "format": relative.suffix.removeprefix(".").casefold() or "binary",
        "mediaType": media_type,
        "role": "evidence_artifact",
        "rowCount": None,
        "sizeBytes": path.stat().st_size,
        "sha256": _sha256(path),
    }


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if not line:
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise EntityReviewError(
                    f"Expected an object at {path}:{line_number}"
                )
            rows.append(value)
    except (OSError, json.JSONDecodeError) as error:
        raise EntityReviewError(f"Unable to read JSONL {path}: {error}") from error
    return rows


def _validate_final_inputs(
    *,
    candidates: list[dict[str, Any]],
    evidence_file: Path,
    decisions_file: Path,
    source_silver_release: str,
    version: str,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, int]]:
    evidence = _load_jsonl(evidence_file)
    candidate_ids = {row["candidateId"] for row in candidates}
    evidence_by_id: dict[str, dict[str, Any]] = {}
    for row in evidence:
        evidence_id = str(row.get("evidenceId") or "")
        candidate_id = str(row.get("candidateId") or "")
        if not evidence_id or evidence_id in evidence_by_id:
            raise EntityReviewError(f"Invalid or duplicate evidenceId: {evidence_id}")
        if candidate_id not in candidate_ids:
            raise EntityReviewError(
                f"Evidence {evidence_id} uses unknown candidate: {candidate_id}"
            )
        required = {"publisher", "sourceType", "url", "observedAt"}
        missing = sorted(key for key in required if not row.get(key))
        if missing:
            raise EntityReviewError(
                f"Evidence {evidence_id} is missing: {', '.join(missing)}"
            )
        content_hash = row.get("contentSha256")
        if row.get("preserved") is True and (
            not isinstance(content_hash, str)
            or len(content_hash) != 64
            or any(
                character not in "0123456789abcdefABCDEF"
                for character in content_hash
            )
        ):
            raise EntityReviewError(
                f"Preserved evidence {evidence_id} requires a SHA-256"
            )
        evidence_by_id[evidence_id] = row

    decisions = _read_json(decisions_file)
    if decisions.get("schemaVersion") != "2.0.0":
        raise EntityReviewError("Review decisions require schemaVersion 2.0.0")
    if decisions.get("sourceSilverRelease") != source_silver_release:
        raise EntityReviewError("Review decisions use the wrong Silver release")
    if decisions.get("batchId") != version:
        raise EntityReviewError("Review decisions use the wrong batch ID")
    raw_decisions = decisions.get("decisions")
    if not isinstance(raw_decisions, list):
        raise EntityReviewError("Review decisions must contain a decisions list")
    by_candidate: dict[str, dict[str, Any]] = {}
    counts: dict[str, int] = {}
    for row in raw_decisions:
        if not isinstance(row, dict):
            raise EntityReviewError("Every review decision must be an object")
        candidate_id = str(row.get("candidate_id") or "")
        decision = str(row.get("decision") or "")
        if candidate_id not in candidate_ids or candidate_id in by_candidate:
            raise EntityReviewError(
                f"Invalid or duplicate review candidate: {candidate_id}"
            )
        if decision not in TERMINAL_DECISIONS:
            raise EntityReviewError(f"Invalid terminal decision: {decision}")
        organization_type = row.get("organizationType")
        if organization_type not in ORGANIZATION_TYPES:
            raise EntityReviewError(
                f"Invalid organization type for {candidate_id}: {organization_type}"
            )
        required_values = ("reviewMethod", "reviewedAt", "reviewer", "reviewer_note")
        missing = [key for key in required_values if not row.get(key)]
        if missing:
            raise EntityReviewError(
                f"Decision {candidate_id} is missing: {', '.join(missing)}"
            )
        evidence_ids = row.get("evidenceIds")
        if not isinstance(evidence_ids, list) or not evidence_ids:
            raise EntityReviewError(f"Decision {candidate_id} has no evidence")
        for evidence_id in evidence_ids:
            linked = evidence_by_id.get(str(evidence_id))
            if linked is None or linked.get("candidateId") != candidate_id:
                raise EntityReviewError(
                    f"Decision {candidate_id} references invalid evidence {evidence_id}"
                )
        linked_evidence = [evidence_by_id[str(value)] for value in evidence_ids]
        selected = row.get("selected_company_id")
        if decision == "accepted":
            if organization_type != "company" or not selected:
                raise EntityReviewError(
                    f"Accepted decision {candidate_id} requires a company"
                )
            has_stable_identifier = any(
                str(item.get("identifierType") or "").casefold()
                in STABLE_IDENTIFIER_TYPES
                and bool(item.get("identifierValue"))
                and item.get("preserved") is True
                for item in linked_evidence
            )
            independent_official_sources = {
                (
                    str(item.get("publisher") or "").casefold(),
                    str(item.get("url") or ""),
                )
                for item in linked_evidence
                if str(item.get("sourceType") or "").casefold()
                in OFFICIAL_EVIDENCE_TYPES
                and item.get("preserved") is True
                and item.get("legalName")
                and item.get("country")
            }
            if not has_stable_identifier and len(independent_official_sources) < 2:
                raise EntityReviewError(
                    f"Accepted decision {candidate_id} lacks strong official evidence"
                )
            local_entity = row.get("localEntity")
            if local_entity is not None:
                if not isinstance(local_entity, dict) or local_entity.get(
                    "companyId"
                ) != selected:
                    raise EntityReviewError(
                        f"Accepted local entity {candidate_id} has an invalid ID"
                    )
                for key in ("preferredName", "legalName", "country"):
                    if not local_entity.get(key):
                        raise EntityReviewError(
                            f"Accepted local entity {candidate_id} is missing {key}"
                        )
        elif selected or row.get("localEntity") is not None:
            raise EntityReviewError(
                f"Non-accepted decision {candidate_id} cannot select a company"
            )
        if decision == "non_company" and organization_type in {"company", "unknown"}:
            raise EntityReviewError(
                f"Non-company decision {candidate_id} requires a concrete type"
            )
        by_candidate[candidate_id] = row
        counts[decision] = counts.get(decision, 0) + 1
    missing_candidates = sorted(candidate_ids - by_candidate.keys())
    if missing_candidates:
        raise EntityReviewError(
            "Review batch is missing terminal decisions for "
            f"{len(missing_candidates)} candidates"
        )
    return evidence, decisions, dict(sorted(counts.items()))


def _default_output_root(silver_manifest_path: Path, version: str) -> Path:
    release_root = silver_manifest_path.resolve().parent
    try:
        data_root = release_root.parents[2]
    except IndexError as error:
        raise EntityReviewError("Unable to infer project-data root") from error
    return data_root / "reviews" / "ai-domains" / version


def prepare_entity_review(
    *,
    silver_manifest_path: Path,
    version: str,
    output_root: Path | None = None,
    unmatched_min_patents: int = 5,
    expected_candidates: int | None = None,
    expected_impact: int | None = None,
    evidence_file: Path | None = None,
    decisions_file: Path | None = None,
    evidence_artifacts_dir: Path | None = None,
) -> dict[str, Any]:
    """Create an immutable, deterministic entity-review worklist."""
    silver_manifest_path = silver_manifest_path.resolve()
    output_root = (
        output_root or _default_output_root(silver_manifest_path, version)
    ).resolve()
    if (output_root / "manifest.json").is_file():
        manifest = verify_entity_review(output_root / "manifest.json")
        if manifest.get("silverManifestSha256") != _sha256(silver_manifest_path):
            raise EntityReviewError("Existing batch uses a different Silver manifest")
        return manifest
    if output_root.exists():
        raise EntityReviewError(
            f"Review output already exists without manifest: {output_root}"
        )

    silver = _read_json(silver_manifest_path)
    if silver.get("status") != "passed" or silver.get("publishable") is not True:
        raise EntityReviewError("Entity review requires a publishable Silver release")
    silver_root = silver_manifest_path.parent
    review_path = _verify_registered_file(
        silver_root, _manifest_file(silver, "entity_review.csv")
    )
    _verify_registered_file(
        silver_root, _manifest_file(silver, "company_candidates.parquet")
    )
    parties_path = _verify_registered_file(
        silver_root, _manifest_file(silver, "patent_parties.parquet")
    )
    patents_path = _verify_registered_file(
        silver_root, _manifest_file(silver, "patents.parquet")
    )
    candidates = _load_candidates(review_path, unmatched_min_patents)
    impact = sum(row["patentCount"] for row in candidates)
    if expected_candidates is not None and len(candidates) != expected_candidates:
        raise EntityReviewError(
            f"Expected {expected_candidates} candidates, found {len(candidates)}"
        )
    if expected_impact is not None and impact != expected_impact:
        raise EntityReviewError(f"Expected impact {expected_impact}, found {impact}")
    _add_context(candidates, parties_path, patents_path)
    if (evidence_file is None) != (decisions_file is None):
        raise EntityReviewError(
            "Final review preparation requires both evidence and decisions"
        )
    if evidence_artifacts_dir is not None and evidence_file is None:
        raise EntityReviewError(
            "Evidence artifacts require final evidence and decisions"
        )
    final_evidence: list[dict[str, Any]] | None = None
    final_decisions: dict[str, Any] | None = None
    decision_counts: dict[str, int] = {}
    artifact_inputs: list[tuple[PurePosixPath, Path]] = []
    if evidence_file is not None and decisions_file is not None:
        final_evidence, final_decisions, decision_counts = _validate_final_inputs(
            candidates=candidates,
            evidence_file=evidence_file.resolve(),
            decisions_file=decisions_file.resolve(),
            source_silver_release=str(silver.get("release")),
            version=version,
        )
        final_evidence, artifact_pairs = _artifact_inputs(
            final_evidence, evidence_artifacts_dir
        )
        artifact_inputs = [(relative, source) for relative, source in artifact_pairs]

    output_root.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{version}-", dir=output_root.parent))
    try:
        queue_path = temporary / "queue.jsonl"
        queue_path.write_text(
            "".join(
                json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
                for row in candidates
            ),
            encoding="utf-8",
        )
        if final_evidence is None or final_decisions is None:
            evidence_path = temporary / "evidence-template.jsonl"
            evidence_path.write_text(
                "".join(
                    json.dumps(
                        {
                            "candidateId": row["candidateId"],
                            "researchStatus": "pending",
                            "evidence": [],
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                    + "\n"
                    for row in candidates
                ),
                encoding="utf-8",
            )
            decisions_path = temporary / "decisions-template.json"
            _write_json(
                decisions_path,
                {
                    "schemaVersion": "2.0.0",
                    "sourceSilverRelease": silver.get("release"),
                    "batchId": version,
                    "decisions": [
                        {
                            "candidate_id": row["candidateId"],
                            "decision": None,
                            "organizationType": None,
                            "reviewMethod": None,
                            "reviewedAt": None,
                            "selected_company_id": None,
                            "evidenceIds": [],
                            "reviewer": None,
                            "reviewer_note": None,
                        }
                        for row in candidates
                    ],
                },
            )
        else:
            artifact_entries: list[dict[str, Any]] = []
            for relative, source in artifact_inputs:
                destination = temporary / "evidence-artifacts" / Path(*relative.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
                artifact_entries.append(
                    _artifact_file_entry(destination, relative)
                )
            evidence_path = temporary / "evidence.jsonl"
            evidence_path.write_text(
                "".join(
                    json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
                    for row in final_evidence
                ),
                encoding="utf-8",
            )
            decisions_path = temporary / "decisions.json"
            _write_json(decisions_path, final_decisions)
        files = [
            _file_entry(queue_path, len(candidates), "jsonl"),
            _file_entry(
                evidence_path,
                len(final_evidence) if final_evidence is not None else len(candidates),
                "jsonl",
            ),
            _file_entry(decisions_path, len(candidates), "json"),
        ]
        if final_evidence is not None:
            files.extend(artifact_entries)
        manifest = {
            "schemaVersion": "1.0.0",
            "release": version,
            "status": "passed" if final_decisions is not None else "prepared",
            "sourceSilverRelease": silver.get("release"),
            "silverManifestPath": str(silver_manifest_path),
            "silverManifestSha256": _sha256(silver_manifest_path),
            "selection": {
                "includeAllStatuses": ["needs_review"],
                "includeUnmatchedMinimumPatents": unmatched_min_patents,
            },
            "candidateCount": len(candidates),
            "candidatePatentImpact": impact,
            "evidenceCount": len(final_evidence or []),
            "decisionCount": sum(decision_counts.values()),
            "decisionCounts": decision_counts,
            "remainingActiveCandidates": (
                0 if final_decisions is not None else len(candidates)
            ),
            "files": files,
            "generatedAt": datetime.now(UTC).isoformat(),
        }
        _write_json(temporary / "manifest.json", manifest)
        os.replace(temporary, output_root)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return verify_entity_review(output_root / "manifest.json")


def verify_entity_review(manifest_path: Path) -> dict[str, Any]:
    """Verify an entity-review worklist and all registered hashes."""
    manifest_path = manifest_path.resolve()
    manifest = _read_json(manifest_path)
    root = manifest_path.parent
    for entry in manifest.get("files", []):
        _verify_registered_file(root, entry)
    silver_path = Path(str(manifest.get("silverManifestPath", "")))
    if not silver_path.is_file():
        raise EntityReviewError("Source Silver manifest is missing")
    if _sha256(silver_path) != manifest.get("silverManifestSha256"):
        raise EntityReviewError("Source Silver manifest SHA-256 mismatch")
    queue_path = root / "queue.jsonl"
    rows = [
        json.loads(line)
        for line in queue_path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    if len(rows) != manifest.get("candidateCount"):
        raise EntityReviewError("Review queue candidate count mismatch")
    impact = sum(int(row["patentCount"]) for row in rows)
    if impact != manifest.get("candidatePatentImpact"):
        raise EntityReviewError("Review queue patent impact mismatch")
    if manifest.get("status") == "passed":
        evidence_entry = _manifest_file(manifest, "evidence.jsonl")
        decisions_entry = _manifest_file(manifest, "decisions.json")
        evidence, decisions, counts = _validate_final_inputs(
            candidates=rows,
            evidence_file=root / evidence_entry["path"],
            decisions_file=root / decisions_entry["path"],
            source_silver_release=str(manifest.get("sourceSilverRelease")),
            version=str(manifest.get("release")),
        )
        artifact_entries = {
            str(entry.get("path")): entry
            for entry in manifest.get("files", [])
            if entry.get("role") == "evidence_artifact"
        }
        referenced_artifacts = {
            str(row.get("artifactPath"))
            for row in evidence
            if row.get("artifactPath")
        }
        if referenced_artifacts != set(artifact_entries):
            raise EntityReviewError("Review evidence artifact registration mismatch")
        for row in evidence:
            artifact_path = row.get("artifactPath")
            if artifact_path and row.get("contentSha256") != artifact_entries[
                str(artifact_path)
            ].get("sha256"):
                raise EntityReviewError(
                    f"Review evidence artifact hash mismatch: {artifact_path}"
                )
        if len(evidence) != manifest.get("evidenceCount"):
            raise EntityReviewError("Review evidence count mismatch")
        if len(decisions["decisions"]) != manifest.get("decisionCount"):
            raise EntityReviewError("Review decision count mismatch")
        if counts != manifest.get("decisionCounts"):
            raise EntityReviewError("Review decision distribution mismatch")
        if manifest.get("remainingActiveCandidates") != 0:
            raise EntityReviewError("Final review batch still has active candidates")
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--silver-manifest", type=Path, required=True)
    prepare.add_argument("--version", required=True)
    prepare.add_argument("--output-root", type=Path)
    prepare.add_argument("--unmatched-min-patents", type=int, default=5)
    prepare.add_argument("--expected-candidates", type=int)
    prepare.add_argument("--expected-impact", type=int)
    prepare.add_argument("--evidence-file", type=Path)
    prepare.add_argument("--decisions-file", type=Path)
    prepare.add_argument("--evidence-artifacts", type=Path)
    verify = subparsers.add_parser("verify")
    verify.add_argument("--manifest", type=Path, required=True)
    return parser


def main() -> None:
    args = _parser().parse_args()
    if args.command == "prepare":
        manifest = prepare_entity_review(
            silver_manifest_path=args.silver_manifest,
            version=args.version,
            output_root=args.output_root,
            unmatched_min_patents=args.unmatched_min_patents,
            expected_candidates=args.expected_candidates,
            expected_impact=args.expected_impact,
            evidence_file=args.evidence_file,
            decisions_file=args.decisions_file,
            evidence_artifacts_dir=args.evidence_artifacts,
        )
        print(
            "Prepared entity-review batch: "
            f"{manifest['release']} ({manifest['candidateCount']} candidates)"
        )
    else:
        manifest = verify_entity_review(args.manifest)
        print(f"Verified entity-review batch: {manifest['release']}")


if __name__ == "__main__":
    main()
