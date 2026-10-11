from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_REGION_PATTERN = re.compile(r"^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]+$")
_RESOURCE_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class PolicyRequirements(BaseModel):
    """Validated constraints returned by get_policy_requirements."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    enabled: bool = True
    allowed_regions: tuple[str, ...] = ()
    max_budget: float | None = Field(default=None, gt=0)
    required_tags: dict[str, str] = Field(default_factory=dict)
    prohibited_resource_types: tuple[str, ...] = ()
    required_encryption: bool = False
    required_backup: bool = False

    @field_validator("allowed_regions")
    @classmethod
    def validate_regions(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(values) != len(set(values)):
            raise ValueError("allowed_regions must be unique")
        if any(not _REGION_PATTERN.fullmatch(value) for value in values):
            raise ValueError("allowed_regions contains an invalid region")
        return values

    @field_validator("required_tags")
    @classmethod
    def validate_tags(cls, values: dict[str, str]) -> dict[str, str]:
        if any(not key.strip() or not value.strip() for key, value in values.items()):
            raise ValueError("required_tags keys and values must not be blank")
        return values

    @field_validator("prohibited_resource_types")
    @classmethod
    def validate_resource_types(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(values) != len(set(values)):
            raise ValueError("prohibited_resource_types must be unique")
        if any(not _RESOURCE_TYPE_PATTERN.fullmatch(value) for value in values):
            raise ValueError("prohibited_resource_types contains an invalid type")
        return values

    @model_validator(mode="after")
    def validate_enabled_constraints(self) -> PolicyRequirements:
        if self.enabled and not self.allowed_regions:
            raise ValueError("enabled policies must define at least one allowed region")
        return self
