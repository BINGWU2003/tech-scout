from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ENV = Path(__file__).resolve().parents[2] / ".env"
DATABASE_ENV = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(SERVICE_ENV, DATABASE_ENV),
        extra="ignore",
        env_parse_none_str="null",
    )
    database_url: SecretStr
    intelligence_internal_token: SecretStr = Field(min_length=32)
    acquisition_profile_dir: Path = Path.home() / ".tech-scout" / "browser-profile"
    acquisition_interval_seconds: float = Field(default=5, ge=5)
    acquisition_company_cache_days: int = Field(default=30, ge=1)
    acquisition_browser_channel: str = "chrome"
    deepseek_api_key: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    anthropic_api_key: SecretStr = SecretStr("")
    llm_provider: Literal["openai", "anthropic", "deepseek"] = "openai"
    llm_model: str = "gpt-6.1-sol"
    llm_base_url: str | None = None
    llm_structured_method: Literal["json_schema", "function_calling", "json_mode"] = (
        "json_schema"
    )
    llm_reasoning_effort: (
        Literal["none", "low", "medium", "high", "xhigh", "max"] | None
    ) = "low"
    llm_use_responses_api: bool = True
    research_output_tokens: int = Field(default=8192, ge=128, le=8192)
    research_model_timeout_seconds: int = Field(default=60, ge=1, le=300)
    research_max_parallel: int = Field(default=2, ge=1, le=10)

    def execution_policy(self):
        return {
            "provider": self.llm_provider,
            "model": self.llm_model,
            "base_url": self.llm_base_url,
            "structured_method": self.llm_structured_method,
            "reasoning_effort": self.llm_reasoning_effort,
            "use_responses_api": self.llm_use_responses_api,
            "output_tokens": self.research_output_tokens,
            "timeout_seconds": self.research_model_timeout_seconds,
            "workflow_version": "browser-v3",
            "prompt_version": "research-advisor-v2",
        }


@lru_cache
def settings() -> Settings:
    # Required values are supplied by BaseSettings from the service .env file.
    return Settings()  # pyright: ignore[reportCallIssue]
