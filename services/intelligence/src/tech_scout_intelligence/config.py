from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore"
    )
    intelligence_database_url: SecretStr
    intelligence_catalog_database_url: SecretStr
    intelligence_internal_token: SecretStr = Field(min_length=32)
    deepseek_api_key: SecretStr = SecretStr("")
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    research_max_seconds: int = Field(default=300, ge=1, le=3600)
    research_max_requests: int = Field(default=6, ge=1, le=100)
    research_max_cny: float = Field(default=1, gt=0, le=100)
    research_output_tokens: int = Field(default=4096, ge=128, le=8192)
    research_input_cny_per_million: float = Field(default=3, gt=0)
    research_output_cny_per_million: float = Field(default=9, gt=0)
    research_model_timeout_seconds: int = Field(default=60, ge=1, le=300)
    research_max_parallel: int = Field(default=2, ge=1, le=10)

    def execution_policy(self):
        return {
            "model": self.deepseek_model,
            "base_url": self.deepseek_base_url,
            "output_tokens": self.research_output_tokens,
            "timeout_seconds": self.research_model_timeout_seconds,
            "input_cny_per_million": self.research_input_cny_per_million,
            "output_cny_per_million": self.research_output_cny_per_million,
            "thinking": "disabled",
            "workflow_version": "phase2-v1",
            "prompt_version": "phase2-v1",
        }


@lru_cache
def settings() -> Settings:
    return Settings()
