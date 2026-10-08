from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ENV = Path(__file__).resolve().parents[2] / ".env"
DATABASE_ENV = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(SERVICE_ENV, DATABASE_ENV),
        extra="ignore",
    )
    database_url: SecretStr
    intelligence_internal_token: SecretStr = Field(min_length=32)
    acquisition_profile_dir: Path = Path.home() / ".tech-scout" / "browser-profile"
    acquisition_interval_seconds: float = Field(default=5, ge=5)
    acquisition_company_cache_days: int = Field(default=30, ge=1)
    acquisition_browser_channel: str = "chrome"
    deepseek_api_key: SecretStr = SecretStr("")
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    research_output_tokens: int = Field(default=8192, ge=128, le=8192)
    research_model_timeout_seconds: int = Field(default=60, ge=1, le=300)
    research_max_parallel: int = Field(default=2, ge=1, le=10)

    def execution_policy(self):
        return {
            "model": self.deepseek_model,
            "base_url": self.deepseek_base_url,
            "output_tokens": self.research_output_tokens,
            "timeout_seconds": self.research_model_timeout_seconds,
            "workflow_version": "browser-v3",
            "prompt_version": "research-advisor-v2",
        }


@lru_cache
def settings() -> Settings:
    # Required values are supplied by BaseSettings from the service .env file.
    return Settings()  # pyright: ignore[reportCallIssue]
