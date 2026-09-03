"""Stable repository and pipeline path discovery."""

from __future__ import annotations

from pathlib import Path


class RepositoryRootError(RuntimeError):
    """Raised when the TechScout repository root cannot be located."""


def repository_root(start: Path | None = None) -> Path:
    """Find the repository root without relying on a fixed module depth."""
    candidate = (start or Path(__file__)).resolve()
    if candidate.is_file():
        candidate = candidate.parent
    for directory in (candidate, *candidate.parents):
        if (directory / "package.json").is_file() and (
            directory / "pnpm-workspace.yaml"
        ).is_file():
            return directory
    raise RepositoryRootError(f"TechScout repository root not found from {candidate}")


def data_foundation_root(start: Path | None = None) -> Path:
    """Return the configured offline pipeline project root."""
    return repository_root(start) / "pipelines" / "data-foundation"
