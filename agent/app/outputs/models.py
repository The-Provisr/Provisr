from __future__ import annotations

import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.manifest import ResourceManifest

_SEMVER_PATTERN = re.compile(
    r"^(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-(?:0|[1-9][0-9]*|[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[a-zA-Z-][0-9a-zA-Z-]*))*)?"
    r"(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$"
)
_IDENTIFIER_PATTERN = re.compile(r"^[a-z][a-z0-9_.-]*$")


class OutputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class OutputMetadata(OutputModel):
    confidence: float = Field(ge=0.0, le=1.0)
    source: Literal["llm_generated", "template", "user_input"]
    warnings: tuple[str, ...] = ()

    @field_validator("warnings")
    @classmethod
    def validate_warnings(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if any(not value.strip() for value in values):
            raise ValueError("warnings must not contain blank values")
        return values


class AssistantMessageData(OutputModel):
    message: str = Field(min_length=1, max_length=10000)


from types import MappingProxyType


def _freeze_payload(value: object) -> object:
    if isinstance(value, dict):
        return MappingProxyType({k: _freeze_payload(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze_payload(v) for v in value)
    return value


class ComponentPayloadData(OutputModel):
    component_id: str = Field(min_length=1, max_length=128)
    payload: dict[str, object]

    @field_validator("component_id")
    @classmethod
    def validate_component_id(cls, value: str) -> str:
        if not _IDENTIFIER_PATTERN.fullmatch(value):
            raise ValueError("component_id must use a safe lowercase identifier")
        return value

    @field_validator("payload", mode="after")
    @classmethod
    def validate_payload(cls, value: dict[str, object]) -> dict[str, object]:
        return _freeze_payload(value)  # type: ignore[return-value]


class ManifestDraftData(OutputModel):
    message: str = Field(min_length=1, max_length=10000)
    manifest: ResourceManifest


class ClarificationQuestionData(OutputModel):
    question: str = Field(min_length=1, max_length=10000)


class ToolSummaryData(OutputModel):
    tool_name: str = Field(min_length=1, max_length=128)
    summary: str = Field(min_length=1, max_length=10000)

    @field_validator("tool_name")
    @classmethod
    def validate_tool_name(cls, value: str) -> str:
        if not _IDENTIFIER_PATTERN.fullmatch(value):
            raise ValueError("tool_name must use a safe lowercase identifier")
        return value


class ErrorData(OutputModel):
    code: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=10000)
    retryable: bool = False

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not _IDENTIFIER_PATTERN.fullmatch(value):
            raise ValueError("code must use a safe lowercase identifier")
        return value


class EnvelopeModel(OutputModel):
    version: str
    request_id: UUID
    metadata: OutputMetadata

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        if not _SEMVER_PATTERN.fullmatch(value):
            raise ValueError("version must be a valid semantic version")
        return value


class AssistantMessageEnvelope(EnvelopeModel):
    type: Literal["assistant_message"]
    data: AssistantMessageData


class ComponentPayloadEnvelope(EnvelopeModel):
    type: Literal["component_payload"]
    data: ComponentPayloadData


class ManifestDraftEnvelope(EnvelopeModel):
    type: Literal["manifest_draft"]
    data: ManifestDraftData


class ClarificationQuestionEnvelope(EnvelopeModel):
    type: Literal["clarification_question"]
    data: ClarificationQuestionData


class ToolSummaryEnvelope(EnvelopeModel):
    type: Literal["tool_summary"]
    data: ToolSummaryData


class ErrorEnvelope(EnvelopeModel):
    type: Literal["error"]
    data: ErrorData


AgentOutputEnvelope = Annotated[
    AssistantMessageEnvelope
    | ComponentPayloadEnvelope
    | ManifestDraftEnvelope
    | ClarificationQuestionEnvelope
    | ToolSummaryEnvelope
    | ErrorEnvelope,
    Field(discriminator="type"),
]
