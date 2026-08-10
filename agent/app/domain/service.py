from datetime import UTC, datetime
from uuid import uuid4

from app.domain.models import (
    AgentEvent,
    AgentEventType,
    AgentSession,
    ConversationMessage,
    ModelTurnResult,
)
from app.integrations.anthropic_model import LanguageModel
from app.integrations.state import StateStore
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
    ) -> None:
        self._state = state
        self._model = model
        self._profile_selector = profile_selector

    async def create_session(
        self,
        *,
        organization_id: str,
        request_id: str,
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

    async def run_turn(self, *, session_id: str, message: str) -> ModelTurnResult:
        session = await self._state.get_session(session_id)
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

        result = await self._model.complete_turn(session, profile)
        completed_at = datetime.now(UTC)
        session.messages.append(
            ConversationMessage(role="assistant", content=result.message, created_at=completed_at)
        )
        session.updated_at = completed_at
        await self._state.save_session(session)
        await self._append_event(
            session,
            "clarification.required"
            if result.outcome == "needs_clarification"
            else "manifest.proposed",
            result.model_dump(mode="json", exclude_none=True),
        )
        await self._append_event(session, "stream.completed", {"outcome": result.outcome})
        return result

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
