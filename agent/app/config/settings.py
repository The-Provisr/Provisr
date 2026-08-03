from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="PROVISR_",
        extra="ignore",
    )

    service_name: str = "provisr-agent"
    environment: Literal["development", "test", "staging", "production"] = "development"
    log_level: str = "INFO"

    state_backend: Literal["memory", "redis"] = "memory"
    redis_url: str = "redis://localhost:6379/0"
    session_ttl_seconds: int = Field(default=7200, ge=60, le=86400)

    # Claude via the Anthropic SDK targeting Claude Platform on AWS. These read the
    # unprefixed ANTHROPIC_* env vars (matching svc-agent), not the PROVISR_ prefix.
    anthropic_api_key: str = Field(default="", validation_alias="ANTHROPIC_API_KEY")
    anthropic_base_url: str = Field(default="", validation_alias="ANTHROPIC_BASE_URL")
    anthropic_workspace_id: str = Field(default="", validation_alias="ANTHROPIC_WORKSPACE_ID")
    anthropic_model: str = Field(default="claude-sonnet-4-5", validation_alias="ANTHROPIC_MODEL")



@lru_cache
def load_settings() -> Settings:
    return Settings()
