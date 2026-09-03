from pathlib import Path

import pytest

from data_foundation.shared.paths import RepositoryRootError, repository_root


def test_repository_root_walks_up_without_fixed_parent_depth(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    nested = root / "arbitrary" / "deep" / "module.py"
    nested.parent.mkdir(parents=True)
    nested.write_text("", encoding="utf-8")
    (root / "package.json").write_text("{}", encoding="utf-8")
    (root / "pnpm-workspace.yaml").write_text("packages: []", encoding="utf-8")

    assert repository_root(nested) == root


def test_repository_root_rejects_an_unmarked_tree(tmp_path: Path) -> None:
    with pytest.raises(RepositoryRootError, match="repository root not found"):
        repository_root(tmp_path)
