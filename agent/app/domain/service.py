from datetime import UTC, datetime
from uuid import uuid4

from app.domain.drafting import (
    DraftingContext,
    PolicyConstraints,
    PolicyViolationError,
    draft_manifest,
)
from app.domain.models import (
    AgentEvent,
    AgentEventType,
    AgentSession,
    ConversationMessage,
    ModelTurnResult,
)
from app.integrations.anthropic_model import LanguageModel
from app.integrations.state import StateStore
from app.prompts.errors import ProfileNotFound, PromptIntegrityError, VersionNotFound
from app.prompts.registry import PromptRegistry

_PROVISIONING_PROFILE = "provisioning_agent"


class AgentService:
    def __init__(
        self,
        *,
        state: StateStore,
        model: LanguageModel,
        prompt_registry: PromptRegistry,
        policy_constraints: PolicyConstraints | None = None,
        workspace_id: str = "",
    ) -> None:
        self._state = state
        self._model = model
        self._prompt_registry = prompt_registry
        # Policy constraints may be injected at construction (e.g. from MCP client)
        # or remain empty (policies disabled / test mode).
        self._policy_constraints = policy_constraints or PolicyConstraints()
        self._workspace_id = workspace_id

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
        try:
            prompt = self._prompt_registry.get_prompt(
                session.prompt_profile,
                session.prompt_version,
            )
        except (ProfileNotFound, VersionNotFound) as error:
            raise PromptIntegrityError("Pinned prompt is no longer available") from error
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

        # ------------------------------------------------------------------ #
        # Manifest drafting: when the model produces a manifest candidate,   #
        # synthesise the fully-annotated CanonicalManifest (AG-005) and emit #
        # a manifest.draft event alongside manifest.proposed.                #
        # Policy violations are converted to a needs_clarification result so #
        # the user receives a plain-language explanation.                     #
        # ------------------------------------------------------------------ #
        if result.outcome == "manifest_candidate" and result.manifest is not None:
            result = await self._draft_canonical(result, session, message)

        completed_at = datetime.now(UTC)
        session.messages.append(
            ConversationMessage(role="assistant", content=result.message, created_at=completed_at)
        )
        session.updated_at = completed_at
        await self._state.save_session(session)

        if result.outcome == "needs_clarification":
            await self._append_event(
                session,
                "clarification.required",
                result.model_dump(mode="json", exclude_none=True),
            )
        else:
            # Emit manifest.draft first (enriched), then manifest.proposed (raw summary)
            if result.canonical_manifest is not None:
                await self._append_event(
                    session,
                    "manifest.draft",
                    result.canonical_manifest.model_dump(mode="json"),
                )
            await self._append_event(
                session,
                "manifest.proposed",
                result.model_dump(mode="json", exclude_none=True),
            )

        await self._append_event(session, "stream.completed", {"outcome": result.outcome})
        return result

    async def _draft_canonical(
        self,
        result: ModelTurnResult,
        session: AgentSession,
        user_message: str,
    ) -> ModelTurnResult:
        """Run policy pre-flight and produce a ``CanonicalManifest``.

        Returns the original result enriched with ``canonical_manifest``, or a
        ``needs_clarification`` result if a policy violation is detected.
        """
        assert result.manifest is not None  # guaranteed by caller
        ctx = DraftingContext(
            request_id=session.request_id,
            workspace_id=self._workspace_id or session.organization_id,
            user_prompt=user_message,
            policy=self._policy_constraints,
        )
        try:
            canonical = draft_manifest(result.manifest, ctx)
            return result.model_copy(update={"canonical_manifest": canonical})
        except PolicyViolationError as exc:
            violation_summary = " ".join(exc.violations)
            return ModelTurnResult(
                outcome="needs_clarification",
                message=(
                    "Your request conflicts with workspace policy: "
                    f"{violation_summary} "
                    "Please adjust your request to comply with the policy constraints."
                ),
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
