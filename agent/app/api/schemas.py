from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models import AgentSession
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


class RunTurnResponse(ApiModel):
    result: AgentOutputEnvelope


RunState = Literal[
    "received",
    "pending_policy",
    "pending_cloud_context",
    "pending_agent",
    "manifest_ready",
    "pending_iac",
    "plan_ready",
    "pending_policy_check",
    "pending_confirmation",
    "pending_approval",
    "pending_execution",
    "executing",
    "completed",
    "failed",
    "cancelled",
]


class AgentMessage(ApiModel):
    role: Literal["user", "assistant", "system"]
    content: str


class AgentToolCall(ApiModel):
    tool_name: str
    ok: bool
    summary: str | None = None


class AgentQuestion(ApiModel):
    id: str
    text: str
    options: list[str] | None = None


class AgentDispatchRequest(ApiModel):
    run_id: UUID
    session_id: UUID
    workspace_id: UUID
    user_id: UUID
    correlation_id: UUID
    phase: RunState
    prompt: str
    history: list[AgentMessage] = Field(default_factory=list)
    question_answer: Any | None = None


class AgentDispatchResponse(ApiModel):
    messages: list[AgentMessage] = Field(default_factory=list)
    tool_calls: list[AgentToolCall] = Field(default_factory=list)
    manifest_draft: Any | None = None
    question: AgentQuestion | None = None
    policy_decision: Literal["allow", "warn", "deny", "requires_approval"] | None = None


class ProblemDetails(ApiModel):
    type: str
    title: str
    status: int
    detail: str
    code: str
