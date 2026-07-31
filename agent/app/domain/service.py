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
from app.prompts.errors import PromptIntegrityError
from app.prompts.registry import PromptRegistry

_PROVISIONING_PROFILE = "provisioning_agent"


class AgentService:
    def __init__(
        self,
        *,
        state: StateStore,
        model: LanguageModel,
        prompt_registry: PromptRegistry,
    ) -> None:
        self._state = state
        self._model = model
        self._prompt_registry = prompt_registry

    async def create_session(
        self,
        *,
        organization_id: str,
        request_id: str,
        prompt_version: str | None = None,
    ) -> AgentSession:
        prompt = self._prompt_registry.get_prompt(_PROVISIONING_PROFILE, prompt_version)
        now = datetime.now(UTC)
        session = AgentSession(
            session_id=str(uuid4()),
            organization_id=organization_id,
            request_id=request_id,
            prompt_id=prompt.prompt_id,
            prompt_profile=prompt.profile,
            prompt_version=prompt.version,
            prompt_hash=prompt.content_hash,
            created_at=now,
            updated_at=now,
        )
        await self._state.save_session(session)
        return session

    async def run_turn(self, *, session_id: str, message: str) -> ModelTurnResult:
        session = await self._state.get_session(session_id)
        prompt = self._prompt_registry.get_prompt(
            session.prompt_profile,
            session.prompt_version,
        )
        if prompt.prompt_id != session.prompt_id or prompt.content_hash != session.prompt_hash:
            raise PromptIntegrityError("Pinned prompt metadata failed integrity validation")

        now = datetime.now(UTC)
        session.messages.append(ConversationMessage(role="user", content=message, created_at=now))
        session.updated_at = now
        await self._state.save_session(session)
        await self._append_event(
            session,
            "turn.started",
            {
                "messageAccepted": True,
                "promptId": str(prompt.prompt_id),
                "promptProfile": prompt.profile,
                "promptVersion": prompt.version,
                "promptHash": prompt.content_hash,
            },
        )

        result = await self._model.complete_turn(session, prompt)
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
