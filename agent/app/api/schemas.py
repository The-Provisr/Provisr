from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models import AgentSession, AnsweredQuestion
from app.outputs.models import AgentOutputEnvelope


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateSessionRequest(ApiModel):
    organization_id: str = Field(min_length=1, max_length=128)
    request_id: UUID
    profile_id: str = Field(default="provisioning", min_length=1, max_length=64)
    prompt_version: str | None = Field(default=None, min_length=1, max_length=64)


class CreateSessionResponse(ApiModel):
    session: AgentSession


class RunTurnRequest(ApiModel):
    message: str = Field(min_length=1, max_length=20000)
    # Structured answers to a previous clarification question; persisted before
    # the turn so the agent never re-asks a confirmed field.
    answers: list[AnsweredQuestion] = Field(default_factory=list)


class RunTurnResponse(ApiModel):
    result: AgentOutputEnvelope


class ProblemDetails(ApiModel):
    type: str
    title: str
    status: int
    detail: str
    code: str
