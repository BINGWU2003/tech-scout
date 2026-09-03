"""Generate and verify immutable source-data manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from data_foundation.shared.paths import repository_root

INVENTORY_DIRECTORIES = ("raw", "patents", "company")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
SNAPSHOT_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_SAFE_INTEGER = 2**53 - 1
ProgressCallback = Callable[[str], None]


class SourceManifestError(RuntimeError):
    """Raised when a source registry, inventory, or manifest is invalid."""


@dataclass(frozen=True)
class SourceManifestResult:
    """Paths and content produced by a source-manifest build."""

    manifest: dict[str, Any]
    manifest_path: Path
    checksums_path: Path


def _default_config_path() -> Path:
    return repository_root() / "config" / "data-sources.json"


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SourceManifestError(f"JSON document must be an object: {path}")
    return value


def _normalize_relative_path(value: Any, field: str = "path") -> str:
    if not isinstance(value, str) or not value:
        raise SourceManifestError(f"{field} must be a non-empty relative path")
    normalized = value.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", normalized) or normalized.startswith("/"):
        raise SourceManifestError(f"{field} must be relative: {value}")
    path = PurePosixPath(normalized)
    if ".." in path.parts:
        raise SourceManifestError(f"{field} must stay inside the data root: {value}")
    normalized = path.as_posix()
    if normalized in {"", "."}:
        raise SourceManifestError(f"{field} must be a non-empty relative path")
    return normalized.removeprefix("./")


def _validate_source_config(config: dict[str, Any]) -> dict[str, Any]:
    datasets = config.get("datasets")
    files = config.get("files")
    if not isinstance(datasets, dict):
        raise SourceManifestError("Source config must define datasets")
    if not isinstance(files, list) or not files:
        raise SourceManifestError("Source config must define at least one file")

    registered: dict[str, dict[str, Any]] = {}
    for item in files:
        if not isinstance(item, dict):
            raise SourceManifestError("Source config files must be objects")
        path = _normalize_relative_path(item.get("path"))
        item["path"] = path
        if path in registered:
            raise SourceManifestError(f"Duplicate registered path: {path}")
        if item.get("dataset") not in datasets:
            raise SourceManifestError(
                f"Unknown dataset {item.get('dataset')} for {path}"
            )
        if item.get("role") not in {"raw", "extracted"}:
            raise SourceManifestError(f"Invalid role for {path}: {item.get('role')}")
        if not item.get("format") or not item.get("compression"):
            raise SourceManifestError(f"Missing format or compression for {path}")
        if item.get("archivePath") is not None:
            item["archivePath"] = _normalize_relative_path(
                item["archivePath"], "archivePath"
            )
            if not item.get("archiveMember"):
                raise SourceManifestError(f"Missing archiveMember for {path}")
        registered[path] = item

    for item in files:
        archive_path = item.get("archivePath")
        if archive_path is None:
            continue
        archive = registered.get(archive_path)
        if (
            archive is None
            or archive.get("role") != "raw"
            or archive.get("compression") != "zip"
        ):
            raise SourceManifestError(
                f"Archive for {item['path']} is not a registered raw ZIP: "
                f"{archive_path}"
            )

    referenced_archives = {
        item["archivePath"] for item in files if item.get("archivePath")
    }
    for item in files:
        if (
            item.get("role") == "raw"
            and item.get("compression") == "zip"
            and item["path"] not in referenced_archives
        ):
            raise SourceManifestError(
                f"Raw ZIP has no registered extracted member: {item['path']}"
            )
    return config


def _inventory_paths(data_root: Path) -> list[str]:
    paths: list[str] = []
    for directory in INVENTORY_DIRECTORIES:
        absolute_directory = data_root / directory
        if not absolute_directory.is_dir():
            raise SourceManifestError(
                f"Required data directory is missing: {directory}"
            )
        paths.extend(
            path.relative_to(data_root).as_posix()
            for path in absolute_directory.rglob("*")
            if path.is_file()
        )
    return sorted(paths)


def _validate_inventory(data_root: Path, expected_paths: Iterable[str]) -> None:
    actual = _inventory_paths(data_root)
    expected = sorted(expected_paths)
    actual_set = set(actual)
    expected_set = set(expected)
    missing = [path for path in expected if path not in actual_set]
    unexpected = [path for path in actual if path not in expected_set]
    if not missing and not unexpected:
        return

    details: list[str] = []
    if missing:
        details.append("Missing files:\n- " + "\n- ".join(missing))
    if unexpected:
        details.append("Unexpected files:\n- " + "\n- ".join(unexpected))
    raise SourceManifestError(
        "Data inventory does not match the registry.\n" + "\n".join(details)
    )


def _iso_utc_milliseconds(timestamp_ns: int) -> str:
    milliseconds = timestamp_ns // 1_000_000
    value = datetime.fromtimestamp(milliseconds / 1000, UTC)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _now_utc_milliseconds() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _fingerprint(path: Path) -> dict[str, str | int]:
    before = path.stat()
    if not path.is_file() or before.st_size <= 0:
        raise SourceManifestError(f"File is empty or is not a regular file: {path}")

    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)

    after = path.stat()
    if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
        raise SourceManifestError(f"File changed while hashing: {path}")
    return {
        "sha256": digest.hexdigest(),
        "sizeBytes": after.st_size,
        "observedMtimeUtc": _iso_utc_milliseconds(after.st_mtime_ns),
    }


def _validate_content_groups(files: list[dict[str, Any]]) -> None:
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in files:
        group = item.get("contentGroup")
        if group:
            groups.setdefault(group, []).append(item)
    for group, members in groups.items():
        if len(members) < 2:
            raise SourceManifestError(
                f"Content group {group} must contain at least two files"
            )
        if len({item["sha256"] for item in members}) != 1:
            paths = ", ".join(item["path"] for item in members)
            raise SourceManifestError(f"Content group {group} does not match: {paths}")


def _validate_manifest_structure(manifest: dict[str, Any]) -> None:
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise SourceManifestError("Manifest does not contain files")
    if manifest.get("fileCount") != len(files):
        raise SourceManifestError("Manifest fileCount does not match files.length")

    paths: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            raise SourceManifestError("Manifest files must be objects")
        path = _normalize_relative_path(item.get("path"))
        item["path"] = path
        if path in paths:
            raise SourceManifestError(f"Duplicate path in manifest: {path}")
        if not isinstance(item.get("sha256"), str) or not SHA256_PATTERN.fullmatch(
            item["sha256"]
        ):
            raise SourceManifestError(f"Invalid SHA-256 for {path}")
        size = item.get("sizeBytes")
        if (
            not isinstance(size, int)
            or isinstance(size, bool)
            or size <= 0
            or size > MAX_SAFE_INTEGER
        ):
            raise SourceManifestError(f"Invalid size for {path}")
        archive = item.get("archive")
        if archive is not None:
            if not isinstance(archive, dict):
                raise SourceManifestError(f"Invalid archive for {path}")
            archive["path"] = _normalize_relative_path(
                archive.get("path"), "archive.path"
            )
            if not archive.get("member"):
                raise SourceManifestError(f"Missing archive member for {path}")
        paths.add(path)

    for item in files:
        archive = item.get("archive")
        if archive is not None and archive["path"] not in paths:
            raise SourceManifestError(
                f"Manifest archive for {item['path']} is missing: {archive['path']}"
            )
    _validate_content_groups(files)


def _write_atomic(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary_path.write_text(contents, encoding="utf-8", newline="\n")
    os.replace(temporary_path, path)


def generate_source_manifest(
    *,
    data_root: Path,
    snapshot: str,
    config_path: Path | None = None,
    output_directory: Path | None = None,
    on_progress: ProgressCallback | None = None,
) -> SourceManifestResult:
    """Generate a source manifest and checksum file from the registry."""
    if not SNAPSHOT_PATTERN.fullmatch(snapshot):
        raise SourceManifestError("snapshot must use YYYY-MM-DD format")

    absolute_data_root = data_root.resolve()
    absolute_config_path = (config_path or _default_config_path()).resolve()
    config = _validate_source_config(_read_json(absolute_config_path))
    config_files = config["files"]
    _validate_inventory(
        absolute_data_root, (item["path"] for item in config_files)
    )

    manifest_files: list[dict[str, Any]] = []
    sorted_files = sorted(config_files, key=lambda item: item["path"])
    for index, item in enumerate(sorted_files, start=1):
        if on_progress:
            on_progress(f"[{index}/{len(sorted_files)}] {item['path']}")
        dataset = config["datasets"][item["dataset"]]
        fingerprint = _fingerprint(
            absolute_data_root.joinpath(*PurePosixPath(item["path"]).parts)
        )
        manifest_files.append(
            {
                "provider": dataset["provider"],
                "dataset": item["dataset"],
                "datasetName": dataset["name"],
                "role": item["role"],
                "path": item["path"],
                "sizeBytes": fingerprint["sizeBytes"],
                "sha256": fingerprint["sha256"],
                "format": item["format"],
                "compression": item["compression"],
                "sourceUrl": dataset["sourceUrl"],
                "publishedAt": dataset.get("publishedAt"),
                "downloadedAt": None,
                "observedMtimeUtc": fingerprint["observedMtimeUtc"],
                "dataCoverage": item.get("dataCoverage"),
                "schemaVersion": dataset.get("schemaVersion"),
                "license": dataset["license"],
                "archive": (
                    {
                        "path": item["archivePath"],
                        "member": item["archiveMember"],
                    }
                    if item.get("archivePath")
                    else None
                ),
                "contentGroup": item.get("contentGroup"),
            }
        )

    _validate_content_groups(manifest_files)
    release = f"source-{snapshot}"
    manifest = {
        "schemaVersion": config["schemaVersion"],
        "release": release,
        "snapshot": snapshot,
        "generatedAt": _now_utc_milliseconds(),
        "dataRoot": str(absolute_data_root),
        "fileCount": len(manifest_files),
        "rawFileCount": sum(item["role"] == "raw" for item in manifest_files),
        "extractedFileCount": sum(
            item["role"] == "extracted" for item in manifest_files
        ),
        "totalSizeBytes": sum(item["sizeBytes"] for item in manifest_files),
        "files": manifest_files,
    }
    _validate_manifest_structure(manifest)

    absolute_output_directory = (
        output_directory.resolve()
        if output_directory
        else absolute_data_root / "releases" / release
    )
    manifest_path = absolute_output_directory / "manifest.json"
    checksums_path = absolute_output_directory / "SHA256SUMS.txt"
    checksums = "\n".join(
        f"{item['sha256']}  {item['path']}" for item in manifest_files
    )
    _write_atomic(
        manifest_path,
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    )
    _write_atomic(checksums_path, checksums + "\n")
    return SourceManifestResult(manifest, manifest_path, checksums_path)


def verify_source_manifest(
    *,
    manifest_path: Path,
    data_root: Path | None = None,
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Re-hash every registered source file and verify its inventory."""
    absolute_manifest_path = manifest_path.resolve()
    manifest = _read_json(absolute_manifest_path)
    _validate_manifest_structure(manifest)
    absolute_data_root = (
        data_root.resolve() if data_root else Path(manifest["dataRoot"]).resolve()
    )
    files = manifest["files"]
    _validate_inventory(absolute_data_root, (item["path"] for item in files))

    for index, item in enumerate(files, start=1):
        if on_progress:
            on_progress(f"[{index}/{len(files)}] {item['path']}")
        absolute_path = absolute_data_root.joinpath(
            *PurePosixPath(item["path"]).parts
        )
        current_size = absolute_path.stat().st_size
        if current_size != item["sizeBytes"]:
            raise SourceManifestError(
                f"Size mismatch for {item['path']}: expected {item['sizeBytes']}, "
                f"got {current_size}"
            )
        fingerprint = _fingerprint(absolute_path)
        if fingerprint["sha256"] != item["sha256"]:
            raise SourceManifestError(
                f"SHA-256 mismatch for {item['path']}: expected {item['sha256']}, "
                f"got {fingerprint['sha256']}"
            )

    _validate_content_groups(files)
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("generate", help="Generate a source manifest")
    generate.add_argument("--data-root", type=Path, required=True)
    generate.add_argument("--snapshot", required=True)
    generate.add_argument("--config", type=Path, default=_default_config_path())
    generate.add_argument("--output-dir", type=Path)
    verify = commands.add_parser("verify", help="Verify a source manifest")
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--data-root", type=Path)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = _parser().parse_args(argv)
    try:
        if args.command == "generate":
            result = generate_source_manifest(
                data_root=args.data_root,
                snapshot=args.snapshot,
                config_path=args.config,
                output_directory=args.output_dir,
                on_progress=print,
            )
            print(f"Manifest written: {result.manifest_path}")
            print(f"Checksums written: {result.checksums_path}")
        else:
            manifest = verify_source_manifest(
                manifest_path=args.manifest,
                data_root=args.data_root,
                on_progress=print,
            )
            print(f"Verified {manifest['fileCount']} files: {args.manifest.resolve()}")
    except (SourceManifestError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Source manifest error: {error}") from error


if __name__ == "__main__":
    main()
