from __future__ import annotations

import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

_PERMISSION_PATTERN = re.compile(r"^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$")


class MCPContext(BaseModel):
    """Security and trace context required by every MCP tool call."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workspace_id: UUID
    user_id: UUID
    permissions: tuple[str, ...] = Field(min_length=1)
    request_id: UUID
    correlation_id: UUID
    session_id: UUID
    idempotency_key: str | None = Field(default=None, max_length=255)

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(values) != len(set(values)):
            raise ValueError("permissions must be unique")
        if any(not _PERMISSION_PATTERN.fullmatch(value) for value in values):
            raise ValueError("permissions must use the resource:action format")
        return values

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("idempotency_key must not be blank")
        return normalized


def is_valid_permission(value: str) -> bool:
    return _PERMISSION_PATTERN.fullmatch(value) is not None
