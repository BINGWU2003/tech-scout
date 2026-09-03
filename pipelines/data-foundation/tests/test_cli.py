from __future__ import annotations

import pytest

from data_foundation import cli


@pytest.mark.parametrize(
    ("arguments", "expected"),
    [
        (["--help"], "{bronze,silver,review,catalog,report}"),
        (["bronze", "--help"], "{build,verify}"),
        (["silver", "--help"], "{build,verify}"),
        (["review", "--help"], "{prepare,verify}"),
        (["catalog", "--help"], "{migrate,import,verify}"),
        (["report", "--help"], "{minimal}"),
        (["report", "minimal", "--help"], "{build,verify}"),
    ],
)
def test_cli_help(arguments: list[str], expected: str, capsys) -> None:
    with pytest.raises(SystemExit) as result:
        cli.main(arguments)

    assert result.value.code == 0
    assert expected in capsys.readouterr().out


def test_cli_rejects_unknown_command(capsys) -> None:
    with pytest.raises(SystemExit) as result:
        cli.main(["unknown"])

    assert result.value.code == 2
    assert "invalid choice" in capsys.readouterr().err


def test_cli_forwards_arguments_without_redefining_them(monkeypatch) -> None:
    received: list[str] = []
    monkeypatch.setattr(cli.silver, "main", received.extend)

    cli.main(["silver", "build", "--version", "2026-09-v7"])

    assert received == ["build", "--version", "2026-09-v7"]
