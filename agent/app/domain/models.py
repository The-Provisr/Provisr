from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.manifest import ResourceManifest

type AgentEventType = Literal[
    "turn.started",
    "message.completed",
    "clarification.required",
    "manifest.proposed",
    "turn.failed",
    "stream.completed",
]

# Maximum questions the agent may emit in a single clarification pass.
MAX_CLARIFICATION_QUESTIONS = 5

type ClarificationInputType = Literal["text", "select", "multi_select", "boolean", "confirmation"]


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
    request_id: str
    prompt_id: UUID
    prompt_profile: str
    prompt_version: str
    prompt_hash: str
    created_at: datetime
    updated_at: datetime
    messages: list[ConversationMessage] = Field(default_factory=list)
    # Accumulates across turns so the agent never re-asks answered questions.
    answered_questions: list[AnsweredQuestion] = Field(default_factory=list)


class AgentEvent(DomainModel):
    schema_version: Literal["1.0"] = "1.0"
    event_id: str
    session_id: str
    request_id: str
    organization_id: str
    sequence: int = Field(ge=1)
    occurred_at: datetime
    type: AgentEventType
    data: dict[str, object] = Field(default_factory=dict)


class ModelTurnResult(DomainModel):
    outcome: Literal["needs_clarification", "manifest_candidate"]
    message: str = Field(min_length=1, max_length=10000)
    manifest: ResourceManifest | None = None
    # Populated only when outcome == "needs_clarification".
    clarification_questions: list[ClarificationQuestion] = Field(
        default_factory=list,
        max_length=MAX_CLARIFICATION_QUESTIONS,
    )
