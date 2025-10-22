from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.policy.models import PolicyRequirements

# Maximum questions the agent may emit in a single clarification pass.
MAX_CLARIFICATION_QUESTIONS = 5

type ClarificationInputType = Literal["text", "select", "multi_select", "boolean", "confirmation"]

type AgentEventType = Literal[
    "turn.started",
    "policy.requirements.loaded",
    "message.completed",
    "clarification.required",
    "manifest.proposed",
    "manifest.draft",
    "turn.failed",
    "stream.completed",
]


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClarificationQuestion(DomainModel):
    """A single structured clarification question the agent needs answered.

    ``field_mapping`` is a dot-path to the target manifest attribute, e.g.
    ``"region"`` or ``"resources[0].engine"``.  The frontend uses it to
    pre-fill the manifest on answer.
    """

    question_id: str = Field(min_length=1, max_length=64)
    question_text: str = Field(min_length=1, max_length=500)
    input_type: ClarificationInputType
    options: list[str] = Field(default_factory=list, max_length=50)
    required: bool = True
    field_mapping: str = Field(min_length=1, max_length=128)


class AnsweredQuestion(DomainModel):
    """A previously answered clarification question stored in session state.

    Keeping answered questions in the session prevents circular re-asking and
    lets the model incorporate confirmed values without re-inferring them.
    """

    question_id: str = Field(min_length=1, max_length=64)
    field_mapping: str = Field(min_length=1, max_length=128)
    answer: str = Field(min_length=0, max_length=1000)


class ConversationMessage(DomainModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)
    created_at: datetime


class AgentSession(DomainModel):
    session_id: str
    organization_id: str
    request_id: UUID
    status: Literal["ACTIVE", "FAILED"] = "ACTIVE"
    profile_id: str
    prompt_id: UUID
    prompt_profile: str
    prompt_version: str
    prompt_hash: str
    temperature: float
    max_tokens: int
    policy_requirements_loaded: bool = False
    policy_requirements: PolicyRequirements | None = None
    created_at: datetime
    updated_at: datetime
    messages: list[ConversationMessage] = Field(default_factory=list)
    # Accumulates across turns so the agent never re-asks answered questions.
    answered_questions: list[AnsweredQuestion] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_policy_context(self) -> Self:
        if self.policy_requirements_loaded != (self.policy_requirements is not None):
            raise ValueError(
                "policy_requirements_loaded must match the presence of policy_requirements"
            )
        return self


class AgentEvent(DomainModel):
    schema_version: Literal["1.0"] = "1.0"
    event_id: str
    session_id: str
    request_id: UUID
    organization_id: str
    sequence: int = Field(ge=1)
    occurred_at: datetime
    type: AgentEventType
    data: dict[str, object] = Field(default_factory=dict)
