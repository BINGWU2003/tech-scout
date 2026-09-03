"""Unified command-line interface for the offline Data Foundation pipeline."""

from __future__ import annotations

import argparse

from data_foundation.datasets import (
    bronze,
    catalog,
    entity_review,
    silver,
    source_manifest,
)
from data_foundation.reports import minimal


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="data-foundation",
        description="Build, review, publish, and verify TechScout data releases.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "source",
        add_help=False,
        help="Generate or verify source-data manifests",
    )
    commands.add_parser(
        "bronze",
        add_help=False,
        help="Build or verify immutable Bronze releases",
    )
    commands.add_parser(
        "silver",
        add_help=False,
        help="Build or verify domain-specific Silver releases",
    )
    commands.add_parser(
        "review",
        add_help=False,
        help="Prepare or verify entity-review batches",
    )
    commands.add_parser(
        "catalog",
        add_help=False,
        help="Migrate, publish, or verify the PostgreSQL Catalog",
    )

    report = commands.add_parser(
        "report",
        help="Build or verify deterministic reports",
    )
    reports = report.add_subparsers(dest="report", required=True)
    reports.add_parser(
        "minimal",
        add_help=False,
        help="Build or verify the minimal domain research report",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    """Route a Data Foundation command without duplicating module arguments."""
    parser = _parser()
    args, remaining = parser.parse_known_args(argv)

    if args.command == "source":
        source_manifest.main(remaining)
    elif args.command == "bronze":
        bronze.main(remaining)
    elif args.command == "silver":
        silver.main(remaining)
    elif args.command == "review":
        entity_review.main(remaining)
    elif args.command == "catalog":
        catalog.main(remaining)
    elif args.command == "report" and args.report == "minimal":
        minimal.main(remaining)
    else:  # pragma: no cover - argparse enforces the command tree.
        parser.error("unsupported command")


if __name__ == "__main__":
    main()
