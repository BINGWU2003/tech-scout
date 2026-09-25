import pytest
from pydantic import ValidationError

from tech_scout_intelligence.config import Settings


def test_root_database_and_service_settings_preserve_process_precedence(
    tmp_path, monkeypatch
):
    root = tmp_path / "root.env"
    service = tmp_path / "service.env"
    root.write_text("DATABASE_URL=postgresql://root/example\n")
    service.write_text("INTELLIGENCE_INTERNAL_TOKEN=" + "test-token-" * 4 + "\n")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("INTELLIGENCE_INTERNAL_TOKEN", raising=False)
    config = Settings(_env_file=(service, root))  # pyright: ignore[reportCallIssue]
    assert config.database_url.get_secret_value() == "postgresql://root/example"
    assert config.intelligence_internal_token.get_secret_value() == "test-token-" * 4
    monkeypatch.setenv("DATABASE_URL", "postgresql://process/example")
    assert (
        Settings(_env_file=(service, root)).database_url.get_secret_value()  # pyright: ignore[reportCallIssue]
        == "postgresql://process/example"
    )


def test_explicit_settings_do_not_need_a_database_environment(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None, intelligence_internal_token="test-token-" * 4)  # pyright: ignore[reportCallIssue]
    config = Settings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        database_url="postgresql://unused",
        intelligence_internal_token="test-token-" * 4,
    )
    assert config.database_url.get_secret_value() == "postgresql://unused"
