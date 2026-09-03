from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_foundation.datasets.source_manifest import (
    SourceManifestError,
    generate_source_manifest,
    verify_source_manifest,
)


def _create_fixture(tmp_path: Path) -> tuple[Path, Path]:
    data_root = tmp_path / "data"
    for directory in ("raw", "patents", "company"):
        (data_root / directory).mkdir(parents=True)
    (data_root / "raw" / "sample.zip").write_text("archive", encoding="utf-8")
    (data_root / "patents" / "sample.txt").write_text("alpha", encoding="utf-8")
    (data_root / "company" / "source.json").write_text("{}", encoding="utf-8")

    config_path = tmp_path / "sources.json"
    config_path.write_text(
        json.dumps(
            {
                "schemaVersion": "1.0.0",
                "datasets": {
                    "sample": {
                        "provider": "Example",
                        "name": "Fixture data",
                        "sourceUrl": "https://example.com/data",
                        "publishedAt": None,
                        "schemaVersion": None,
                        "license": {
                            "status": "not_recorded",
                            "note": "Test fixture",
                        },
                    }
                },
                "files": [
                    {
                        "dataset": "sample",
                        "role": "raw",
                        "path": "raw/sample.zip",
                        "format": "txt",
                        "compression": "zip",
                        "dataCoverage": None,
                    },
                    {
                        "dataset": "sample",
                        "role": "extracted",
                        "path": "patents/sample.txt",
                        "format": "txt",
                        "compression": "none",
                        "dataCoverage": None,
                        "archivePath": "raw/sample.zip",
                        "archiveMember": "sample.txt",
                    },
                    {
                        "dataset": "sample",
                        "role": "raw",
                        "path": "company/source.json",
                        "format": "json",
                        "compression": "none",
                        "dataCoverage": None,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    return data_root, config_path


def test_generates_and_verifies_a_stable_source_manifest(tmp_path: Path) -> None:
    data_root, config_path = _create_fixture(tmp_path)

    first = generate_source_manifest(
        data_root=data_root,
        snapshot="2026-09-02",
        config_path=config_path,
    )
    assert first.manifest["fileCount"] == 3
    assert first.manifest["rawFileCount"] == 2
    assert first.manifest["extractedFileCount"] == 1
    assert all(len(item["sha256"]) == 64 for item in first.manifest["files"])
    assert all(item["downloadedAt"] is None for item in first.manifest["files"])
    verify_source_manifest(manifest_path=first.manifest_path)

    first_hashes = [
        (item["path"], item["sha256"]) for item in first.manifest["files"]
    ]
    second = generate_source_manifest(
        data_root=data_root,
        snapshot="2026-09-02",
        config_path=config_path,
    )
    assert [
        (item["path"], item["sha256"]) for item in second.manifest["files"]
    ] == first_hashes
    assert [path.name for path in (data_root / "releases").iterdir()] == [
        "source-2026-09-02"
    ]
    assert json.loads(second.manifest_path.read_text(encoding="utf-8"))[
        "fileCount"
    ] == 3
    assert second.checksums_path.read_text(encoding="utf-8").count("\n") == 3


def test_verification_rejects_changed_and_missing_files(tmp_path: Path) -> None:
    data_root, config_path = _create_fixture(tmp_path)
    result = generate_source_manifest(
        data_root=data_root,
        snapshot="2026-09-02",
        config_path=config_path,
    )

    source_path = data_root / "patents" / "sample.txt"
    source_path.write_text("bravo", encoding="utf-8")
    with pytest.raises(SourceManifestError, match="SHA-256 mismatch"):
        verify_source_manifest(manifest_path=result.manifest_path)

    source_path.unlink()
    with pytest.raises(SourceManifestError, match="Missing files"):
        verify_source_manifest(manifest_path=result.manifest_path)


def test_generation_rejects_files_that_are_not_registered(tmp_path: Path) -> None:
    data_root, config_path = _create_fixture(tmp_path)
    (data_root / "company" / "unexpected.csv").write_text(
        "value", encoding="utf-8"
    )

    with pytest.raises(SourceManifestError, match="Unexpected files"):
        generate_source_manifest(
            data_root=data_root,
            snapshot="2026-09-02",
            config_path=config_path,
        )


def test_generation_rejects_registry_paths_outside_data_root(tmp_path: Path) -> None:
    data_root, config_path = _create_fixture(tmp_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["files"][0]["path"] = "raw/../../outside.zip"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(SourceManifestError, match="stay inside the data root"):
        generate_source_manifest(
            data_root=data_root,
            snapshot="2026-09-02",
            config_path=config_path,
        )
