from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore"
    )
    acquisition_database_url: SecretStr
    acquisition_internal_token: SecretStr = Field(min_length=32)
    acquisition_profile_dir: Path = Path.home() / ".tech-scout" / "browser-profile"
    acquisition_interval_seconds: float = Field(default=5, ge=5)
    acquisition_patent_limit: int = Field(default=100, ge=1, le=100)
    acquisition_company_cache_days: int = Field(default=30, ge=1)
    acquisition_browser_channel: str = "chrome"


@lru_cache
def settings():
    return Settings()
