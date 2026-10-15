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


class CloudAccountContext(DomainModel):
    id: UUID
    workspace_id: UUID
    provider: Literal["aws", "azure", "gcp"]
    label: str
    status: Literal["active"]
    verified_at: datetime
    supported_regions: list[str] = Field(min_length=1)
    resource_counts: dict[str, int] | None = None
    quota_limits: dict[str, float] | None = None


class ExistingResourceContext(BaseModel):
    """Safe inventory fields needed for duplicate detection; drop all extras."""

    model_config = ConfigDict(extra="ignore")

    provider: Literal["aws", "azure", "gcp"] | None = None
    region: str | None = None
    name: str | None = None
    id: str | None = None
    type: str | None = None
    resource_type: str | None = None

    @model_validator(mode="after")
    def validate_identity(self) -> Self:
        if not self.name and not self.id:
            raise ValueError("Existing resources must include a name or id")
        return self


class CloudContext(DomainModel):
    # `providers`/`regions`/`existing_resources`/`default_region` are the
    # OR-009 cloud-context envelope. Keep account fields for older callers.
    connected_providers: list[Literal["aws", "azure", "gcp"]] = Field(default_factory=list)
    providers: list[Literal["aws", "azure", "gcp"]] = Field(default_factory=list)
    regions: list[str] = Field(default_factory=list)
    existing_resources: list[ExistingResourceContext] = Field(default_factory=list)
    default_region: str | None = None
    active_accounts: list[CloudAccountContext] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_context_envelope(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        providers = normalized.get("providers") or normalized.get("connected_providers")
        if providers:
            normalized.setdefault("providers", providers)
            normalized.setdefault("connected_providers", providers)
        accounts = normalized.get("active_accounts") or []
        if not normalized.get("regions") and accounts:
            regions: list[str] = []
            for account in accounts:
                if isinstance(account, dict):
                    regions.extend(account.get("supported_regions", []))
                elif isinstance(account, CloudAccountContext):
                    regions.extend(account.supported_regions)
            normalized["regions"] = list(
                dict.fromkeys(regions)
            )
        return normalized

    @model_validator(mode="after")
    def validate_provider_accounts(self) -> Self:
        providers = set(self.connected_providers)
        if not providers:
            raise ValueError("Cloud context must include at least one connected provider")
        if self.providers and set(self.providers) != providers:
            raise ValueError("providers must match connected_providers")
        account_providers = {account.provider for account in self.active_accounts}
        if self.active_accounts and providers != account_providers:
            raise ValueError("Connected providers must match active accounts")
        if self.default_region and self.regions and self.default_region not in self.regions:
            raise ValueError("default_region must be one of the verified regions")
        return self


class ExecutionContext(DomainModel):
    workspace_id: UUID
    user_id: UUID
    policy_context: PolicyRequirements
    cloud_context: CloudContext

    @model_validator(mode="after")
    def validate_accounts(self) -> Self:
        if any(a.workspace_id != self.workspace_id for a in self.cloud_context.active_accounts):
            raise ValueError("Cloud accounts must belong to the execution workspace")
        if self.cloud_context.active_accounts and set(self.cloud_context.connected_providers) != {
            a.provider for a in self.cloud_context.active_accounts
        }:
            raise ValueError("Connected providers must match active accounts")
        return self


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
    execution_context: ExecutionContext | None = None
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
