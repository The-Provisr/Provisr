from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.models import AgentSession, AnsweredQuestion, ExecutionContext
from app.outputs.models import AgentOutputEnvelope


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateSessionRequest(ApiModel):
    organization_id: str = Field(min_length=1, max_length=128)
    request_id: UUID
    profile_id: str = Field(default="provisioning", min_length=1, max_length=64)
    prompt_version: str | None = Field(default=None, min_length=1, max_length=64)
    execution_context: ExecutionContext | None = None

    @model_validator(mode="after")
    def validate_execution_workspace(self) -> "CreateSessionRequest":
        if self.execution_context and str(self.execution_context.workspace_id) != self.organization_id:
            raise ValueError("Execution workspace must match organization_id")
        return self


class CreateSessionResponse(ApiModel):
    session: AgentSession


class RunTurnRequest(ApiModel):
    message: str = Field(min_length=1, max_length=20000)
    # Structured answers to a previous clarification question; persisted before
    # the turn so the agent never re-asks a confirmed field.
    answers: list[AnsweredQuestion] = Field(default_factory=list)


class RunTurnResponse(ApiModel):
    result: AgentOutputEnvelope


class PolicyViolationExplanationRequest(ApiModel):
    rule_key: str = Field(min_length=1, max_length=128)
    severity: str = Field(min_length=1, max_length=32)
    evidence: dict[str, object] = Field(default_factory=dict)
    remediation_hint: str = Field(default="", max_length=2000)


class PolicyViolationExplanationResponse(ApiModel):
    explanation: str
    manifest_part: str
    remediation: str


class ProblemDetails(ApiModel):
    type: str
    title: str
    status: int
    detail: str
    code: str
