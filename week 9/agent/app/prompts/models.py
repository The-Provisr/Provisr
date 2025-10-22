from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_PROFILE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
_TOOL_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
_SEMVER_PATTERN = re.compile(
    r"^(?P<major>0|[1-9][0-9]*)\."
    r"(?P<minor>0|[1-9][0-9]*)\."
    r"(?P<patch>0|[1-9][0-9]*)"
    r"(?:-(?P<prerelease>"
    r"(?:0|[1-9][0-9]*|[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[a-zA-Z-][0-9a-zA-Z-]*))*"
    r"))?"
    r"(?:\+(?P<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class PromptBundle(BaseModel):
    """An immutable, versioned set of instructions and agent constraints."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    prompt_id: UUID
    profile: str
    version: str
    content: str = Field(min_length=1)
    tool_allowlist: tuple[str, ...] = ()
    required_first_calls: tuple[str, ...] = ()
    safety_rules: tuple[str, ...] = ()
    created_at: datetime
    author: str = Field(min_length=1)
    changelog: str = Field(min_length=1)
    content_hash: str = ""

    @field_validator("profile")
    @classmethod
    def validate_profile(cls, value: str) -> str:
        if not _PROFILE_PATTERN.fullmatch(value):
            raise ValueError("profile must use lowercase snake_case")
        return value

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        if not _SEMVER_PATTERN.fullmatch(value):
            raise ValueError("version must be a valid semantic version")
        return value

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value

    @field_validator("tool_allowlist", "required_first_calls")
    @classmethod
    def validate_tool_names(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(values) != len(set(values)):
            raise ValueError("tool names must be unique")
        invalid = [value for value in values if not _TOOL_PATTERN.fullmatch(value)]
        if invalid:
            raise ValueError("tool names must use lowercase snake_case")
        return values

    @field_validator("safety_rules")
    @classmethod
    def validate_safety_rules(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(values) != len(set(values)):
            raise ValueError("safety rules must be unique")
        if any(not value.strip() for value in values):
            raise ValueError("safety rules must not be blank")
        return values

    @field_validator("created_at")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at must include a timezone")
        return value

    @field_validator("author", "changelog")
    @classmethod
    def validate_non_blank_metadata(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("metadata fields must not be blank")
        return value

    @model_validator(mode="after")
    def validate_integrity(self) -> Self:
        missing_calls = set(self.required_first_calls) - set(self.tool_allowlist)
        if missing_calls:
            raise ValueError("required_first_calls must be included in tool_allowlist")

        expected_hash = self.calculate_hash()
        if self.content_hash:
            if not _SHA256_PATTERN.fullmatch(self.content_hash):
                raise ValueError("content_hash must be a lowercase SHA-256 digest")
            if self.content_hash != expected_hash:
                raise ValueError("content_hash does not match the prompt bundle")
        else:
            object.__setattr__(self, "content_hash", expected_hash)
        return self

    def calculate_hash(self) -> str:
        """Hash the complete canonical bundle, excluding the digest itself."""

        canonical_payload = json.dumps(
            self.model_dump(mode="json", exclude={"content_hash"}),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        return hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest()


def semantic_version_key(
    version: str,
) -> tuple[int, int, int, int, tuple[tuple[int, int | str], ...]]:
    """Return a SemVer-precedence key for registry latest-version selection."""

    match = _SEMVER_PATTERN.fullmatch(version)
    if match is None:
        raise ValueError("version must be a valid semantic version")

    prerelease = match.group("prerelease")
    prerelease_key: tuple[tuple[int, int | str], ...] = ()
    if prerelease is not None:
        prerelease_key = tuple(
            (0, int(identifier)) if identifier.isdigit() else (1, identifier)
            for identifier in prerelease.split(".")
        )

    return (
        int(match.group("major")),
        int(match.group("minor")),
        int(match.group("patch")),
        1 if prerelease is None else 0,
        prerelease_key,
    )


def is_prerelease_version(version: str) -> bool:
    match = _SEMVER_PATTERN.fullmatch(version)
    if match is None:
        raise ValueError("version must be a valid semantic version")
    return match.group("prerelease") is not None
