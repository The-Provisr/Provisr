from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.prompts.models import PromptBundle

_PROFILE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class ProfileModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LLMConfig(ProfileModel):
    temperature: float = Field(ge=0.0, le=2.0)
    max_tokens: int = Field(ge=1, le=8192)


class ProfileDefinition(ProfileModel):
    profile_id: str
    prompt_profile: str
    active: bool
    llm_config: LLMConfig

    @field_validator("profile_id", "prompt_profile")
    @classmethod
    def validate_profile_name(cls, value: str) -> str:
        if not _PROFILE_PATTERN.fullmatch(value):
            raise ValueError("profile names must use lowercase snake_case")
        return value


class ProfileBundle(ProfileModel):
    """Complete, version-pinned configuration for one agent run."""

    profile_id: str
    prompt: PromptBundle
    llm_config: LLMConfig

    @field_validator("profile_id")
    @classmethod
    def validate_profile_id(cls, value: str) -> str:
        if not _PROFILE_PATTERN.fullmatch(value):
            raise ValueError("profile_id must use lowercase snake_case")
        return value

    @computed_field
    @property
    def system_prompt(self) -> str:
        return self.prompt.content

    @computed_field
    @property
    def allowed_tools(self) -> tuple[str, ...]:
        return self.prompt.tool_allowlist

    @computed_field
    @property
    def required_first_calls(self) -> tuple[str, ...]:
        return self.prompt.required_first_calls

    @computed_field
    @property
    def safety_rules(self) -> tuple[str, ...]:
        return self.prompt.safety_rules

    @computed_field
    @property
    def prompt_version(self) -> str:
        return self.prompt.version

    @computed_field
    @property
    def prompt_hash(self) -> str:
        return self.prompt.content_hash
