from datetime import UTC, datetime
from uuid import uuid4

from app.domain.clarification import (
    build_answered_context,
    detect_gaps,
)
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
    AnsweredQuestion,
    ConversationMessage,
    ModelTurnResult,
)
from app.integrations.anthropic_model import LanguageModel
from app.integrations.state import StateStore
from app.prompts.errors import ProfileNotFound, PromptIntegrityError, VersionNotFound
from app.prompts.models import PromptBundle
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

        # ------------------------------------------------------------------ #
        # Gap detection: check for missing/ambiguous fields before the model  #
        # call so we can emit structured questions immediately.               #
        # ------------------------------------------------------------------ #
        gaps = detect_gaps(message, answered_questions=session.answered_questions)
        if gaps:
            # Build a fast-path clarification result without calling the LLM.
            questions_summary = "; ".join(q.question_text for q in gaps)
            result = ModelTurnResult(
                outcome="needs_clarification",
                message=gaps[0].question_text,
                clarification_questions=gaps,
            )
            completed_at = datetime.now(UTC)
            session.messages.append(
                ConversationMessage(
                    role="assistant",
                    content=questions_summary,
                    created_at=completed_at,
                )
            )
            session.updated_at = completed_at
            await self._state.save_session(session)
            await self._append_event(
                session,
                "clarification.required",
                result.model_dump(mode="json", exclude_none=True),
            )
            await self._append_event(session, "stream.completed", {"outcome": result.outcome})
            return result

        # ------------------------------------------------------------------ #
        # Inject confirmed answers as context so the model never re-asks.    #
        # ------------------------------------------------------------------ #
        augmented_prompt = _augment_prompt(prompt, session.answered_questions)
        result = await self._model.complete_turn(session, augmented_prompt)

        # If the model produced additional clarification questions, merge any
        # new ones that are not already answered.
        answered_fields = {aq.field_mapping for aq in session.answered_questions}
        new_questions = [
            q for q in result.clarification_questions if q.field_mapping not in answered_fields
        ]
        if new_questions != result.clarification_questions:
            result = result.model_copy(update={"clarification_questions": new_questions})

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

    async def record_clarification_answers(
        self,
        *,
        session_id: str,
        answers: list[AnsweredQuestion],
    ) -> AgentSession:
        """Persist a batch of clarification answers into the session.

        Call this when the frontend submits answers to a ``clarification.required``
        event before the next ``run_turn``.  Duplicate ``field_mapping`` entries
        are deduplicated (last value wins) to prevent state bloat.
        """
        session = await self._state.get_session(session_id)
        # Build a dict keyed by field_mapping so last-write wins on duplicates.
        merged: dict[str, AnsweredQuestion] = {
            aq.field_mapping: aq for aq in session.answered_questions
        }
        for answer in answers:
            merged[answer.field_mapping] = answer
        session = session.model_copy(
            update={
                "answered_questions": list(merged.values()),
                "updated_at": datetime.now(UTC),
            }
        )
        await self._state.save_session(session)
        return session

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


def _augment_prompt(
    prompt: PromptBundle,
    answered_questions: list[AnsweredQuestion],
) -> PromptBundle:
    """Return a prompt with confirmed-answers context prepended to its content.

    When there are no answered questions the original bundle is returned
    unchanged (no allocation, no hash invalidation risk).
    """
    context_block = build_answered_context(answered_questions)
    if not context_block:
        return prompt
    # Use object.__setattr__ to bypass the frozen dataclass constraint on the
    # in-memory copy — we deliberately do not update content_hash because this
    # is a runtime augmentation, not a permanent bundle change.
    augmented = prompt.model_copy()
    object.__setattr__(augmented, "content", context_block + prompt.content)
    return augmented
