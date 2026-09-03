from __future__ import annotations

import hashlib
import json
from pathlib import Path

import duckdb
import pytest

from data_foundation.datasets.bronze import BronzeError, build_bronze, verify_bronze


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    data_root = tmp_path / "data"
    (data_root / "patents").mkdir(parents=True)
    (data_root / "company").mkdir()
    annual_2024 = data_root / "patents" / "2024.csv"
    annual_2025 = data_root / "patents" / "2025.csv"
    patent = data_root / "patents" / "patent.tsv"
    sec = data_root / "company" / "companies.json"
    annual_2024.write_text(
        "patent_number,grant_year,assignee\n100,2024,Alpha\n",
        encoding="utf-8",
    )
    annual_2025.write_text(
        "patent_number,grant_year,assignee\n101,2025,Beta\n",
        encoding="utf-8",
    )
    patent.write_text(
        "patent_id\tpatent_title\n100\tExample patent\n101\tSecond patent\n",
        encoding="utf-8",
    )
    _write_json(
        sec,
        {
            "fields": ["cik", "name", "ticker", "exchange"],
            "data": [[1, "Alpha Inc", "ALP", "NYSE"]],
        },
    )

    entries = [
        (annual_2024, "patents/2024.csv", "annual", "extracted", "csv"),
        (annual_2025, "patents/2025.csv", "annual", "extracted", "csv"),
        (patent, "patents/patent.tsv", "patent", "extracted", "tsv"),
        (sec, "company/companies.json", "sec", "raw", "json"),
    ]
    source_manifest_path = tmp_path / "source-manifest.json"
    _write_json(
        source_manifest_path,
        {
            "release": "source-test",
            "files": [
                {
                    "path": relative_path,
                    "dataset": dataset,
                    "role": role,
                    "format": file_format,
                    "sizeBytes": path.stat().st_size,
                    "sha256": _sha256(path),
                }
                for path, relative_path, dataset, role, file_format in entries
            ],
        },
    )
    configuration_path = tmp_path / "bronze-config.json"
    _write_json(
        configuration_path,
        {
            "schemaVersion": "1.0.0",
            "pipelineVersion": "test-v1",
            "duckdb": {
                "memoryLimit": "1GB",
                "threads": 1,
                "compression": "zstd",
                "rowGroupSize": 1000,
            },
            "tables": [
                {
                    "id": "annual",
                    "outputPath": "uspto/annual.parquet",
                    "input": {
                        "dataset": "annual",
                        "role": "extracted",
                        "format": "csv",
                    },
                    "parser": "delimited",
                    "delimiter": ",",
                    "expectedInputCount": 2,
                    "expectedSourceColumns": 3,
                    "expectedRows": 2,
                    "requiredColumns": ["patent_number", "grant_year"],
                    "nonEmptyColumns": ["patent_number"],
                },
                {
                    "id": "patent",
                    "outputPath": "uspto/patent.parquet",
                    "input": {"path": "patents/patent.tsv"},
                    "parser": "delimited",
                    "delimiter": "\t",
                    "expectedInputCount": 1,
                    "expectedSourceColumns": 2,
                    "expectedRows": 2,
                    "requiredColumns": ["patent_id", "patent_title"],
                    "nonEmptyColumns": ["patent_id"],
                },
                {
                    "id": "sec",
                    "outputPath": "sec/companies.parquet",
                    "input": {
                        "dataset": "sec",
                        "role": "raw",
                        "format": "json",
                    },
                    "parser": "sec-company-tickers-json",
                    "expectedInputCount": 1,
                    "expectedSourceColumns": 4,
                    "expectedRows": 1,
                    "requiredColumns": ["cik", "name", "ticker", "exchange"],
                    "nonEmptyColumns": ["cik", "name", "ticker"],
                    "uniqueColumns": ["ticker"],
                },
            ],
        },
    )
    return data_root, source_manifest_path, configuration_path


def test_builds_verifies_and_reuses_immutable_release(tmp_path: Path) -> None:
    data_root, source_manifest, configuration = _fixture(tmp_path)
    manifest = build_bronze(
        data_root=data_root,
        source_manifest_path=source_manifest,
        version="v1",
        configuration_path=configuration,
    )
    assert manifest["fileCount"] == 3
    assert manifest["totalRows"] == 5
    release_root = data_root / "bronze" / "source-test-v1"
    assert verify_bronze(manifest_path=release_root / "manifest.json") == manifest
    assert (
        build_bronze(
            data_root=data_root,
            source_manifest_path=source_manifest,
            version="v1",
            configuration_path=configuration,
        )
        == manifest
    )
    with duckdb.connect(":memory:") as connection:
        annual_path = release_root / "uspto/annual.parquet"
        columns = connection.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{annual_path}')"
        ).fetchall()
    assert {row[0] for row in columns}.issuperset(
        {"patent_number", "_source_path", "_source_sha256", "_source_row_number"}
    )


def test_verification_rejects_changed_parquet(tmp_path: Path) -> None:
    data_root, source_manifest, configuration = _fixture(tmp_path)
    build_bronze(
        data_root=data_root,
        source_manifest_path=source_manifest,
        version="v1",
        configuration_path=configuration,
    )
    output = data_root / "bronze/source-test-v1/uspto/patent.parquet"
    output.write_bytes(output.read_bytes() + b"changed")
    with pytest.raises(BronzeError, match="size mismatch"):
        verify_bronze(manifest_path=data_root / "bronze/source-test-v1/manifest.json")


def test_build_rejects_changed_source(tmp_path: Path) -> None:
    data_root, source_manifest, configuration = _fixture(tmp_path)
    source = data_root / "patents/2024.csv"
    source.write_text(source.read_text(encoding="utf-8") + "102,2024,Gamma\n")
    with pytest.raises(BronzeError, match="Source size mismatch"):
        build_bronze(
            data_root=data_root,
            source_manifest_path=source_manifest,
            version="v1",
            configuration_path=configuration,
        )
