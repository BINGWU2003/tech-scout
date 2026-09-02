"""Build and verify immutable, source-faithful Bronze Parquet releases."""

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

LINEAGE_COLUMNS = (
    "_source_release",
    "_source_path",
    "_source_sha256",
    "_source_row_number",
)
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
VERSION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
ProgressCallback = Callable[[str], None]


class BronzeError(RuntimeError):
    """Raised when a Bronze build or verification invariant fails."""


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BronzeError(f"Unable to read JSON file {path}: {error}") from error
    if not isinstance(value, dict):
        raise BronzeError(f"JSON root must be an object: {path}")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


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
    path = value.replace("\\", "/").removeprefix("./")
    if not path or path == ".." or path.startswith("../") or Path(path).is_absolute():
        raise BronzeError(f"Path must stay inside its release root: {value}")
    return path


def _validate_configuration(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    tables = configuration.get("tables")
    if not isinstance(tables, list) or not tables:
        raise BronzeError("Bronze configuration must contain tables")
    table_ids: set[str] = set()
    output_paths: set[str] = set()
    for table in tables:
        table_id = table.get("id")
        if not isinstance(table_id, str) or not table_id:
            raise BronzeError("Every Bronze table must have an id")
        if table_id in table_ids:
            raise BronzeError(f"Duplicate Bronze table id: {table_id}")
        table_ids.add(table_id)
        output_path = _normalize_relative_path(table.get("outputPath", ""))
        table["outputPath"] = output_path
        if output_path in output_paths:
            raise BronzeError(f"Duplicate Bronze output path: {output_path}")
        output_paths.add(output_path)
        if table.get("parser") not in {"delimited", "sec-company-tickers-json"}:
            raise BronzeError(
                f"Unsupported parser for {table_id}: {table.get('parser')}"
            )
    return tables


def _matches_selector(file: dict[str, Any], selector: dict[str, str]) -> bool:
    return all(file.get(key) == value for key, value in selector.items())


def _resolve_inputs(
    table: dict[str, Any], source_manifest: dict[str, Any]
) -> list[dict[str, Any]]:
    selector = table.get("input")
    if not isinstance(selector, dict) or not selector:
        raise BronzeError(f"Missing input selector for {table['id']}")
    matches = [
        file
        for file in source_manifest.get("files", [])
        if _matches_selector(file, selector)
    ]
    matches.sort(key=lambda file: file["path"])
    expected_count = table.get("expectedInputCount")
    if len(matches) != expected_count:
        raise BronzeError(
            f"{table['id']} expected {expected_count} inputs, found {len(matches)}"
        )
    return matches


def _validate_source_file(data_root: Path, file: dict[str, Any]) -> None:
    relative_path = _normalize_relative_path(file.get("path", ""))
    path = data_root / Path(relative_path)
    if not path.is_file():
        raise BronzeError(f"Source file is missing: {relative_path}")
    expected_size = file.get("sizeBytes")
    actual_size = path.stat().st_size
    if actual_size != expected_size:
        raise BronzeError(
            f"Source size mismatch for {relative_path}: "
            f"expected {expected_size}, got {actual_size}"
        )
    expected_hash = file.get("sha256")
    if not isinstance(expected_hash, str) or not SHA256_PATTERN.fullmatch(
        expected_hash
    ):
        raise BronzeError(f"Invalid source SHA-256 for {relative_path}")
    actual_hash = _sha256_file(path)
    if actual_hash != expected_hash:
        raise BronzeError(
            f"Source SHA-256 mismatch for {relative_path}: "
            f"expected {expected_hash}, got {actual_hash}"
        )


def _read_delimited_header(path: Path, delimiter: str) -> list[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        try:
            return next(csv.reader(source, delimiter=delimiter))
        except StopIteration as error:
            raise BronzeError(f"Delimited source has no header: {path}") from error


def _read_sec_json(path: Path) -> tuple[list[str], list[list[Any]]]:
    payload = _read_json(path)
    fields = payload.get("fields")
    rows = payload.get("data")
    if fields != ["cik", "name", "ticker", "exchange"]:
        raise BronzeError(f"Unexpected SEC fields in {path}: {fields}")
    if not isinstance(rows, list) or any(
        not isinstance(row, list) or len(row) != len(fields) for row in rows
    ):
        raise BronzeError(f"Invalid SEC data rows in {path}")
    return fields, rows


def _validate_input_schema(
    data_root: Path, table: dict[str, Any], inputs: list[dict[str, Any]]
) -> None:
    headers: list[list[str]] = []
    for file in inputs:
        path = data_root / Path(file["path"])
        if table["parser"] == "delimited":
            headers.append(_read_delimited_header(path, table["delimiter"]))
        else:
            fields, _ = _read_sec_json(path)
            headers.append(fields)

    first_header = headers[0]
    if any(header != first_header for header in headers[1:]):
        raise BronzeError(f"Input headers differ for {table['id']}")
    if len(first_header) != table["expectedSourceColumns"]:
        raise BronzeError(
            f"{table['id']} expected {table['expectedSourceColumns']} source columns, "
            f"found {len(first_header)}"
        )
    missing = set(table.get("requiredColumns", [])) - set(first_header)
    if missing:
        raise BronzeError(
            f"{table['id']} is missing required columns: {', '.join(sorted(missing))}"
        )
    conflicts = set(first_header).intersection(LINEAGE_COLUMNS)
    if conflicts:
        raise BronzeError(
            f"{table['id']} source uses reserved lineage columns: "
            f"{', '.join(sorted(conflicts))}"
        )


def _configure_duckdb(
    connection: duckdb.DuckDBPyConnection,
    configuration: dict[str, Any],
    temporary_directory: Path,
) -> None:
    settings = configuration["duckdb"]
    temporary_directory.mkdir(parents=True)
    connection.execute(f"SET memory_limit = {_sql_literal(settings['memoryLimit'])}")
    connection.execute(f"SET threads = {int(settings['threads'])}")
    connection.execute(
        f"SET temp_directory = {_sql_literal(temporary_directory.resolve())}"
    )
    connection.execute("SET preserve_insertion_order = false")
    connection.execute("PRAGMA disable_progress_bar")


def _delimited_select(
    data_root: Path,
    source_release: str,
    file: dict[str, Any],
    delimiter: str,
) -> str:
    path = (data_root / Path(file["path"])).resolve()
    return f"""
        SELECT source.*,
               {_sql_literal(source_release)}::VARCHAR AS _source_release,
               {_sql_literal(file["path"])}::VARCHAR AS _source_path,
               {_sql_literal(file["sha256"])}::VARCHAR AS _source_sha256,
               row_number() OVER ()::BIGINT AS _source_row_number
        FROM read_csv(
          {_sql_literal(path)},
          header = true,
          all_varchar = true,
          delim = {_sql_literal(delimiter)},
          quote = '"',
          escape = '"',
          strict_mode = true,
          parallel = true
        ) AS source
    """


def _create_sec_source(
    connection: duckdb.DuckDBPyConnection,
    data_root: Path,
    source_release: str,
    file: dict[str, Any],
) -> str:
    path = data_root / Path(file["path"])
    _, rows = _read_sec_json(path)
    connection.execute(
        """
        CREATE OR REPLACE TEMP TABLE sec_company_tickers_source (
          cik VARCHAR,
          name VARCHAR,
          ticker VARCHAR,
          exchange VARCHAR,
          _source_row_number BIGINT
        )
        """
    )
    connection.executemany(
        "INSERT INTO sec_company_tickers_source VALUES (?, ?, ?, ?, ?)",
        [
            (
                str(row[0]) if row[0] is not None else None,
                row[1],
                row[2],
                row[3],
                index,
            )
            for index, row in enumerate(rows, start=1)
        ],
    )
    return f"""
        SELECT cik, name, ticker, exchange,
               {_sql_literal(source_release)}::VARCHAR AS _source_release,
               {_sql_literal(file["path"])}::VARCHAR AS _source_path,
               {_sql_literal(file["sha256"])}::VARCHAR AS _source_sha256,
               _source_row_number
        FROM sec_company_tickers_source
    """


def _build_select(
    connection: duckdb.DuckDBPyConnection,
    data_root: Path,
    source_release: str,
    table: dict[str, Any],
    inputs: list[dict[str, Any]],
) -> str:
    if table["parser"] == "sec-company-tickers-json":
        return _create_sec_source(connection, data_root, source_release, inputs[0])
    selects = [
        _delimited_select(data_root, source_release, file, table["delimiter"])
        for file in inputs
    ]
    return "\nUNION ALL\n".join(selects)


def _parquet_schema(
    connection: duckdb.DuckDBPyConnection, path: Path
) -> list[dict[str, str]]:
    rows = connection.execute(
        f"DESCRIBE SELECT * FROM read_parquet({_sql_literal(path.resolve())})"
    ).fetchall()
    return [{"name": row[0], "type": row[1]} for row in rows]


def _quality_check_table(
    connection: duckdb.DuckDBPyConnection,
    table: dict[str, Any],
    output_path: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    parquet = f"read_parquet({_sql_literal(output_path.resolve())})"
    non_empty_columns = table.get("nonEmptyColumns", [])
    expressions = ["count(*)::BIGINT AS row_count"]
    expressions.extend(
        f"sum(CASE WHEN {_sql_identifier(column)} IS NULL "
        f"OR trim({_sql_identifier(column)}) = '' THEN 1 ELSE 0 END)::BIGINT "
        f"AS {_sql_identifier(f'empty_{index}')}"
        for index, column in enumerate(non_empty_columns)
    )
    values = connection.execute(
        f"SELECT {', '.join(expressions)} FROM {parquet}"
    ).fetchone()
    row_count = values[0]
    checks: list[dict[str, Any]] = []
    checks.append(
        {
            "name": f"{table['id']}.row_count",
            "status": "passed" if row_count == table["expectedRows"] else "failed",
            "expected": table["expectedRows"],
            "actual": row_count,
        }
    )
    for index, column in enumerate(non_empty_columns, start=1):
        empty_count = values[index]
        checks.append(
            {
                "name": f"{table['id']}.non_empty.{column}",
                "status": "passed" if empty_count == 0 else "failed",
                "expected": 0,
                "actual": empty_count,
            }
        )

    for column, expected_count in table.get("expectedEmptyCounts", {}).items():
        empty_count = connection.execute(
            f"SELECT count(*) FROM {parquet} "
            f"WHERE {_sql_identifier(column)} IS NULL "
            f"OR trim({_sql_identifier(column)}) = ''"
        ).fetchone()[0]
        checks.append(
            {
                "name": f"{table['id']}.expected_empty.{column}",
                "status": "passed" if empty_count == expected_count else "failed",
                "expected": expected_count,
                "actual": empty_count,
            }
        )

    schema = _parquet_schema(connection, output_path)
    expected_columns = table["expectedSourceColumns"] + len(LINEAGE_COLUMNS)
    checks.append(
        {
            "name": f"{table['id']}.column_count",
            "status": "passed" if len(schema) == expected_columns else "failed",
            "expected": expected_columns,
            "actual": len(schema),
        }
    )
    actual_columns = {column["name"] for column in schema}
    missing = set(table.get("requiredColumns", [])).difference(actual_columns)
    checks.append(
        {
            "name": f"{table['id']}.required_columns",
            "status": "passed" if not missing else "failed",
            "expected": [],
            "actual": sorted(missing),
        }
    )

    for column in table.get("uniqueColumns", []):
        duplicate_count = connection.execute(
            f"SELECT count(*) - count(DISTINCT {_sql_identifier(column)}) "
            f"FROM {parquet}"
        ).fetchone()[0]
        checks.append(
            {
                "name": f"{table['id']}.unique.{column}",
                "status": "passed" if duplicate_count == 0 else "failed",
                "expected": 0,
                "actual": duplicate_count,
            }
        )

    result = {
        "dataset": table["id"],
        "path": table["outputPath"],
        "rowCount": row_count,
        "columnCount": len(schema),
        "schema": schema,
        "sizeBytes": output_path.stat().st_size,
        "sha256": _sha256_file(output_path),
    }
    return result, checks


def _scalar_check(
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


def _cross_table_checks(
    connection: duckdb.DuckDBPyConnection, release_root: Path
) -> list[dict[str, Any]]:
    def parquet(relative_path: str) -> str:
        path = (release_root / relative_path).resolve()
        return f"read_parquet({_sql_literal(path)})"

    annual = parquet("uspto/pvannual.parquet")
    entities = parquet("gleif/entities.parquet")
    relationships = parquet("gleif/relationships.parquet")
    sec = parquet("sec/companies.parquet")
    return [
        _scalar_check(
            connection,
            "uspto-pvannual.distinct_patents",
            f"SELECT count(DISTINCT patent_number) FROM {annual}",
            3_560_914,
        ),
        _scalar_check(
            connection,
            "gleif-entities.valid_lei_format",
            f"SELECT count(*) FROM {entities} "
            "WHERE NOT regexp_full_match(LEI, '[A-Z0-9]{20}')",
            0,
        ),
        _scalar_check(
            connection,
            "gleif-relationships.unresolved_start_nodes",
            f'SELECT count(DISTINCT r."Relationship.StartNode.NodeID") '
            f"FROM {relationships} r LEFT JOIN {entities} e "
            'ON r."Relationship.StartNode.NodeID" = e.LEI WHERE e.LEI IS NULL',
            0,
        ),
        _scalar_check(
            connection,
            "gleif-relationships.unresolved_end_node_rows",
            "SELECT count(*) "
            f"FROM {relationships} r LEFT JOIN {entities} e "
            'ON r."Relationship.EndNode.NodeID" = e.LEI WHERE e.LEI IS NULL',
            6,
        ),
        _scalar_check(
            connection,
            "gleif-relationships.unresolved_distinct_end_nodes",
            f'SELECT count(DISTINCT r."Relationship.EndNode.NodeID") '
            f"FROM {relationships} r LEFT JOIN {entities} e "
            'ON r."Relationship.EndNode.NodeID" = e.LEI WHERE e.LEI IS NULL',
            5,
        ),
        _scalar_check(
            connection,
            "sec-companies.missing_exchange",
            f"SELECT count(*) FROM {sec} WHERE exchange IS NULL OR trim(exchange) = ''",
            201,
        ),
        _scalar_check(
            connection,
            "sec-companies.duplicate_cik_rows",
            f"SELECT count(*) - count(DISTINCT cik) FROM {sec}",
            2_390,
        ),
    ]


def _input_manifest_entries(inputs: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "path": file["path"],
            "sizeBytes": file["sizeBytes"],
            "sha256": file["sha256"],
        }
        for file in inputs
    ]


def _validate_all_checks(checks: list[dict[str, Any]]) -> None:
    failures = [check for check in checks if check["status"] != "passed"]
    if failures:
        summary = "; ".join(
            f"{check['name']}: expected {check['expected']}, got {check['actual']}"
            for check in failures
        )
        raise BronzeError(f"Bronze quality checks failed: {summary}")


def build_bronze(
    *,
    data_root: Path,
    source_manifest_path: Path,
    version: str,
    configuration_path: Path,
    on_progress: ProgressCallback = lambda _message: None,
) -> dict[str, Any]:
    """Build a versioned Bronze release and return its manifest."""
    if not VERSION_PATTERN.fullmatch(version):
        raise BronzeError(
            "version must contain lowercase letters, numbers, dots or dashes"
        )
    data_root = data_root.resolve()
    source_manifest_path = source_manifest_path.resolve()
    configuration_path = configuration_path.resolve()
    source_manifest = _read_json(source_manifest_path)
    configuration = _read_json(configuration_path)
    tables = _validate_configuration(configuration)
    source_release = source_manifest.get("release")
    if not isinstance(source_release, str) or not source_release:
        raise BronzeError("Source manifest has no release id")
    release = f"{source_release}-{version}"
    release_root = data_root / "bronze" / release
    manifest_path = release_root / "manifest.json"
    if release_root.exists():
        on_progress(f"Release already exists; verifying {release}")
        return verify_bronze(manifest_path=manifest_path, on_progress=on_progress)

    resolved_inputs: dict[str, list[dict[str, Any]]] = {}
    unique_inputs: dict[str, dict[str, Any]] = {}
    for table in tables:
        inputs = _resolve_inputs(table, source_manifest)
        _validate_input_schema(data_root, table, inputs)
        resolved_inputs[table["id"]] = inputs
        for file in inputs:
            unique_inputs[file["path"]] = file

    for index, file in enumerate(unique_inputs.values(), start=1):
        on_progress(f"Validating source [{index}/{len(unique_inputs)}] {file['path']}")
        _validate_source_file(data_root, file)

    bronze_root = data_root / "bronze"
    bronze_root.mkdir(parents=True, exist_ok=True)
    temporary_root = bronze_root / f".{release}.tmp-{os.getpid()}"
    if temporary_root.exists():
        raise BronzeError(f"Temporary build directory already exists: {temporary_root}")
    temporary_root.mkdir()

    connection = duckdb.connect(":memory:")
    try:
        _configure_duckdb(
            connection, configuration, temporary_root / ".duckdb-temporary"
        )
        table_results: list[dict[str, Any]] = []
        checks: list[dict[str, Any]] = []
        for index, table in enumerate(tables, start=1):
            on_progress(f"Building [{index}/{len(tables)}] {table['id']}")
            output_path = temporary_root / Path(table["outputPath"])
            output_path.parent.mkdir(parents=True, exist_ok=True)
            query = _build_select(
                connection,
                data_root,
                source_release,
                table,
                resolved_inputs[table["id"]],
            )
            settings = configuration["duckdb"]
            connection.execute(
                f"COPY ({query}) TO {_sql_literal(output_path.resolve())} "
                "(FORMAT PARQUET, "
                f"COMPRESSION {_sql_literal(settings['compression'])}, "
                f"ROW_GROUP_SIZE {int(settings['rowGroupSize'])})"
            )
            result, table_checks = _quality_check_table(connection, table, output_path)
            result["inputs"] = _input_manifest_entries(resolved_inputs[table["id"]])
            table_results.append(result)
            checks.extend(table_checks)

        if configuration.get("qualityProfile") == "tech-scout-2026-09-02":
            on_progress("Running cross-table quality checks")
            checks.extend(_cross_table_checks(connection, temporary_root))
        _validate_all_checks(checks)
        total_rows = sum(table["rowCount"] for table in table_results)
        total_size = sum(table["sizeBytes"] for table in table_results)
        generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        quality_report = {
            "schemaVersion": "1.0.0",
            "release": release,
            "generatedAt": generated_at,
            "status": "passed",
            "checkCount": len(checks),
            "checks": checks,
        }
        manifest = {
            "schemaVersion": configuration["schemaVersion"],
            "release": release,
            "layer": "bronze",
            "sourceRelease": source_release,
            "sourceManifest": {
                "path": str(source_manifest_path),
                "sha256": _sha256_file(source_manifest_path),
            },
            "pipelineVersion": configuration["pipelineVersion"],
            "generatedAt": generated_at,
            "duckdbVersion": duckdb.__version__,
            "fileCount": len(table_results),
            "totalRows": total_rows,
            "totalSizeBytes": total_size,
            "files": table_results,
            "qualityReport": "quality_report.json",
        }
        _write_json(temporary_root / "quality_report.json", quality_report)
        _write_json(temporary_root / "manifest.json", manifest)
        temporary_duckdb = temporary_root / ".duckdb-temporary"
        if temporary_duckdb.exists() and not any(temporary_duckdb.iterdir()):
            temporary_duckdb.rmdir()
        temporary_root.replace(release_root)
        on_progress(f"Bronze release written: {release_root}")
        return manifest
    finally:
        connection.close()


def verify_bronze(
    *,
    manifest_path: Path,
    on_progress: ProgressCallback = lambda _message: None,
) -> dict[str, Any]:
    """Verify Parquet hashes, sizes, schemas, and row counts for a Bronze release."""
    manifest_path = manifest_path.resolve()
    manifest = _read_json(manifest_path)
    release_root = manifest_path.parent
    files = manifest.get("files")
    if not isinstance(files, list) or manifest.get("fileCount") != len(files):
        raise BronzeError("Bronze manifest fileCount is invalid")
    connection = duckdb.connect(":memory:")
    try:
        total_rows = 0
        total_size = 0
        for index, file in enumerate(files, start=1):
            relative_path = _normalize_relative_path(file.get("path", ""))
            on_progress(f"Verifying [{index}/{len(files)}] {relative_path}")
            path = release_root / Path(relative_path)
            if not path.is_file():
                raise BronzeError(f"Bronze file is missing: {relative_path}")
            actual_size = path.stat().st_size
            if actual_size != file.get("sizeBytes"):
                raise BronzeError(
                    f"Bronze size mismatch for {relative_path}: "
                    f"expected {file.get('sizeBytes')}, got {actual_size}"
                )
            actual_hash = _sha256_file(path)
            if actual_hash != file.get("sha256"):
                raise BronzeError(f"Bronze SHA-256 mismatch for {relative_path}")
            actual_rows = connection.execute(
                f"SELECT count(*) FROM read_parquet({_sql_literal(path)})"
            ).fetchone()[0]
            if actual_rows != file.get("rowCount"):
                raise BronzeError(
                    f"Bronze row count mismatch for {relative_path}: "
                    f"expected {file.get('rowCount')}, got {actual_rows}"
                )
            actual_columns = len(_parquet_schema(connection, path))
            if actual_columns != file.get("columnCount"):
                raise BronzeError(
                    f"Bronze column count mismatch for {relative_path}: "
                    f"expected {file.get('columnCount')}, got {actual_columns}"
                )
            total_rows += actual_rows
            total_size += actual_size
        if total_rows != manifest.get("totalRows"):
            raise BronzeError("Bronze manifest totalRows is invalid")
        if total_size != manifest.get("totalSizeBytes"):
            raise BronzeError("Bronze manifest totalSizeBytes is invalid")
        quality_report = _read_json(release_root / manifest["qualityReport"])
        if quality_report.get("status") != "passed":
            raise BronzeError("Bronze quality report is not passed")
        on_progress(f"Verified Bronze release: {manifest['release']}")
        return manifest
    finally:
        connection.close()


def _default_configuration_path() -> Path:
    return Path(__file__).resolve().parents[5] / "config" / "bronze-sources.json"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build", help="Build an immutable Bronze release")
    build.add_argument("--data-root", type=Path, required=True)
    build.add_argument("--source-manifest", type=Path, required=True)
    build.add_argument("--version", default="v1")
    build.add_argument("--config", type=Path, default=_default_configuration_path())
    verify = subparsers.add_parser("verify", help="Verify a Bronze release")
    verify.add_argument("--manifest", type=Path, required=True)
    return parser


def main() -> None:
    args = _parser().parse_args()
    if args.command == "build":
        manifest = build_bronze(
            data_root=args.data_root,
            source_manifest_path=args.source_manifest,
            version=args.version,
            configuration_path=args.config,
            on_progress=print,
        )
    else:
        manifest = verify_bronze(manifest_path=args.manifest, on_progress=print)
    print(
        f"{manifest['release']}: {manifest['fileCount']} files, "
        f"{manifest['totalRows']:,} rows, {manifest['totalSizeBytes']:,} bytes"
    )


if __name__ == "__main__":
    main()
