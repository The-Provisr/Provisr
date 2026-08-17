from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.domain.errors import InvalidModelResponseError, SessionFailedError
from app.domain.models import (
    AgentEvent,
    AgentEventType,
    AgentSession,
    ConversationMessage,
)
from app.integrations.anthropic_model import LanguageModel
from app.integrations.state import StateStore
from app.outputs.models import (
    AgentOutputEnvelope,
    AssistantMessageEnvelope,
    ClarificationQuestionEnvelope,
    ComponentPayloadEnvelope,
    ErrorEnvelope,
    ManifestDraftEnvelope,
    ToolSummaryEnvelope,
)
from app.outputs.validation import validate_envelope
from app.policy.compliance import validate_manifest_policy
from app.policy.errors import PolicyRequirementsUnavailableError
from app.policy.tool import PolicyRequirementsTool
from app.profiles.errors import ProfileNotAvailable
from app.profiles.errors import ProfileNotFound as AgentProfileNotFound
from app.profiles.registry import ProfileSelector
from app.prompts.errors import ProfileNotFound as PromptProfileNotFound
from app.prompts.errors import (
    PromptIntegrityError,
    VersionNotFound,
)


class AgentService:
    def __init__(
        self,
        *,
        state: StateStore,
        model: LanguageModel,
        profile_selector: ProfileSelector,
        policy_tool: PolicyRequirementsTool,
    ) -> None:
        self._state = state
        self._model = model
        self._profile_selector = profile_selector
        self._policy_tool = policy_tool

    async def create_session(
        self,
        *,
        organization_id: str,
        request_id: UUID,
        profile_id: str = "provisioning",
        prompt_version: str | None = None,
    ) -> AgentSession:
        profile = self._profile_selector.select_profile(profile_id, prompt_version)
        prompt = profile.prompt
        now = datetime.now(UTC)
        session = AgentSession(
            session_id=str(uuid4()),
            organization_id=organization_id,
            request_id=request_id,
            profile_id=profile.profile_id,
            prompt_id=prompt.prompt_id,
            prompt_profile=prompt.profile,
            prompt_version=prompt.version,
            prompt_hash=prompt.content_hash,
            temperature=profile.llm_config.temperature,
            max_tokens=profile.llm_config.max_tokens,
            created_at=now,
            updated_at=now,
        )
        await self._state.save_session(session)
        return session

    async def run_turn(self, *, session_id: str, message: str) -> AgentOutputEnvelope:
        session = await self._state.get_session(session_id)
        if session.status == "FAILED":
            raise SessionFailedError("Failed agent sessions cannot process additional turns")
        try:
            profile = self._profile_selector.select_profile(
                session.profile_id,
                session.prompt_version,
            )
        except (
            AgentProfileNotFound,
            ProfileNotAvailable,
            PromptProfileNotFound,
            VersionNotFound,
        ) as error:
            raise PromptIntegrityError("Pinned agent profile is no longer available") from error
        prompt = profile.prompt
        if prompt.prompt_id != session.prompt_id or prompt.content_hash != session.prompt_hash:
            raise PromptIntegrityError("Pinned prompt metadata failed integrity validation")
        if (
            profile.llm_config.temperature != session.temperature
            or profile.llm_config.max_tokens != session.max_tokens
        ):
            raise PromptIntegrityError("Pinned agent profile configuration changed")

        now = datetime.now(UTC)
        session.messages.append(ConversationMessage(role="user", content=message, created_at=now))
        session.updated_at = now
        await self._state.save_session(session)
        await self._append_event(
            session,
            "turn.started",
            {
                "messageAccepted": True,
                "profileId": profile.profile_id,
                "promptId": str(prompt.prompt_id),
                "promptProfile": prompt.profile,
                "promptVersion": prompt.version,
                "promptHash": prompt.content_hash,
                "temperature": profile.llm_config.temperature,
                "maxTokens": profile.llm_config.max_tokens,
            },
        )

        await self._ensure_policy_requirements(session)

        try:
            raw_output = await self._model.complete_turn(session, profile)
            validation = validate_envelope(raw_output)
            if not validation.valid or validation.parsed is None:
                details = validation.errors or ("unknown envelope validation error",)
                raise InvalidModelResponseError(
                    f"Agent output failed envelope validation: {'; '.join(details)}"
                )
            result = validation.parsed
            if result.request_id != session.request_id:
                raise InvalidModelResponseError(
                    "Agent output request_id did not match the active request"
                )
            if isinstance(result, ManifestDraftEnvelope):
                if session.policy_requirements is None:
                    raise InvalidModelResponseError(
                        "Manifest draft was produced before policy requirements were loaded"
                    )
                violations = validate_manifest_policy(
                    result.data.manifest,
                    session.policy_requirements,
                )
                if violations:
                    details = "; ".join(
                        f"{violation.message} Alternatives: {' '.join(violation.alternatives)}"
                        for violation in violations
                    )
                    raise InvalidModelResponseError(
                        f"Manifest draft conflicts with policy requirements: {details}"
                    )
        except InvalidModelResponseError as error:
            await self._fail_turn(
                session,
                code="INVALID_AGENT_OUTPUT",
                message="Agent output failed structured envelope validation",
                detail=str(error),
            )
            raise

        completed_at = datetime.now(UTC)
        session.messages.append(
            ConversationMessage(
                role="assistant",
                content=_message_for(result),
                created_at=completed_at,
            )
        )
        if isinstance(result, ErrorEnvelope):
            session.status = "FAILED"
        session.updated_at = completed_at
        await self._state.save_session(session)
        event_data = (
            {
                "code": result.data.code,
                "message": result.data.message,
                "validationError": None,
                "retryable": result.data.retryable,
            }
            if isinstance(result, ErrorEnvelope)
            else result.model_dump(mode="json")
        )
        await self._append_event(
            session,
            _event_type_for(result),
            event_data,
        )
        await self._append_event(
            session,
            "stream.completed",
            {"outputType": result.type, "sessionStatus": session.status},
        )
        return result

    async def _ensure_policy_requirements(self, session: AgentSession) -> None:
        if session.policy_requirements_loaded:
            return

        try:
            requirements = await self._policy_tool.get_policy_requirements(session)
        except PolicyRequirementsUnavailableError as error:
            await self._fail_turn(
                session,
                code=error.code,
                message="Policy requirements could not be loaded; manifest drafting is blocked",
                detail=str(error),
            )
            raise

        session.policy_requirements = requirements
        session.policy_requirements_loaded = True
        session.updated_at = datetime.now(UTC)
        await self._state.save_session(session)
        await self._append_event(
            session,
            "policy.requirements.loaded",
            {
                "tool": "get_policy_requirements",
                "requirements": requirements.model_dump(mode="json"),
            },
        )

    async def _fail_turn(
        self,
        session: AgentSession,
        *,
        code: str,
        message: str,
        detail: str,
    ) -> None:
        session.status = "FAILED"
        session.updated_at = datetime.now(UTC)
        await self._state.save_session(session)
        await self._append_event(
            session,
            "turn.failed",
            {
                "code": code,
                "message": message,
                "detail": detail,
            },
        )

    async def _append_event(
        self,
        session: AgentSession,
        event_type: AgentEventType,
        data: dict[str, object],
    ) -> None:
        existing = await self._state.list_events(session.session_id, 0)
        sequence = existing[-1].sequence + 1 if existing else 1
        await self._state.append_event(
            AgentEvent(
                event_id=str(uuid4()),
                session_id=session.session_id,
                request_id=session.request_id,
                organization_id=session.organization_id,
                sequence=sequence,
                occurred_at=datetime.now(UTC),
                type=event_type,
                data=data,
            )
        )


def _message_for(envelope: AgentOutputEnvelope) -> str:
    if isinstance(envelope, AssistantMessageEnvelope):
        return envelope.data.message
    if isinstance(envelope, ClarificationQuestionEnvelope):
        return envelope.data.question
    if isinstance(envelope, ManifestDraftEnvelope):
        return envelope.data.message
    if isinstance(envelope, ToolSummaryEnvelope):
        return envelope.data.summary
    if isinstance(envelope, ErrorEnvelope):
        return envelope.data.message
    if isinstance(envelope, ComponentPayloadEnvelope):
        return f"Generated component {envelope.data.component_id}."
    raise TypeError("Unsupported agent output envelope")


def _event_type_for(envelope: AgentOutputEnvelope) -> AgentEventType:
    if isinstance(envelope, ClarificationQuestionEnvelope):
        return "clarification.required"
    if isinstance(envelope, ManifestDraftEnvelope):
        return "manifest.proposed"
    if isinstance(envelope, ErrorEnvelope):
        return "turn.failed"
    return "message.completed"
