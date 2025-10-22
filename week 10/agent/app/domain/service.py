import re
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from app.domain.clarification import build_answered_context, detect_gaps
from app.domain.drafting import (
    DraftingContext,
    PolicyConstraints,
    PolicyViolationError,
    draft_manifest,
)
from app.domain.errors import InvalidModelResponseError, SessionFailedError
from app.domain.manifest import CanonicalManifest, ResourceManifest
from app.domain.models import (
    AgentEvent,
    AgentEventType,
    AgentSession,
    AnsweredQuestion,
    ClarificationInputType,
    ClarificationQuestion,
    ConversationMessage,
    ExecutionContext,
)
from app.integrations.anthropic_model import LanguageModel
from app.integrations.state import StateStore
from app.outputs.models import (
    AgentOutputEnvelope,
    AssistantMessageEnvelope,
    ClarificationAnswerField,
    ClarificationQuestionData,
    ClarificationQuestionEnvelope,
    ComponentPayloadEnvelope,
    ErrorEnvelope,
    ManifestDraftEnvelope,
    OutputMetadata,
    ToolSummaryEnvelope,
)
from app.outputs.validation import validate_envelope
from app.policy.compliance import validate_manifest_policy
from app.policy.errors import PolicyRequirementsUnavailableError
from app.policy.models import PolicyRequirements
from app.policy.tool import PolicyRequirementsTool
from app.profiles.errors import ProfileNotAvailable
from app.profiles.errors import ProfileNotFound as AgentProfileNotFound
from app.profiles.models import ProfileBundle
from app.profiles.registry import ProfileSelector
from app.prompts.errors import ProfileNotFound as PromptProfileNotFound
from app.prompts.errors import (
    PromptIntegrityError,
    VersionNotFound,
)
from app.prompts.models import PromptBundle


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
        execution_context: ExecutionContext | None = None,
    ) -> AgentSession:
        if execution_context and str(execution_context.workspace_id) != organization_id:
            raise ValueError("Execution workspace must match organization_id")
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
            execution_context=execution_context,
            policy_requirements=(execution_context.policy_context if execution_context else None),
            policy_requirements_loaded=execution_context is not None,
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

        # Deterministic gap detection runs before the model so blocking fields
        # (provider, region, environment, ...) are asked immediately. Prior user
        # turns are included so a value given earlier is not asked again.
        user_context = "\n".join(item.content for item in session.messages if item.role == "user")
        gaps = detect_gaps(
            user_context,
            answered_questions=session.answered_questions,
            resolved_fields=_context_resolved_fields(session.execution_context),
            connected_providers=(
                session.execution_context.cloud_context.connected_providers
                if session.execution_context
                else None
            ),
            verified_regions=_context_region_options(
                session.execution_context, session.answered_questions
            ),
        )
        unsupported_provider = _unsupported_selected_provider(
            session.execution_context, session.answered_questions, user_context
        )
        if unsupported_provider:
            provider = unsupported_provider
            result = AssistantMessageEnvelope(
                version="1.0.0",
                request_id=session.request_id,
                metadata=OutputMetadata(confidence=1.0, source="template"),
                type="assistant_message",
                data={
                    "message": (
                        f"This workspace is connected to {provider}, but the current "
                        "manifest format supports AWS resources only. I can't draft a "
                        "manifest for this workspace yet."
                    )
                },
            )
        elif gaps:
            result = _clarification_envelope(session, gaps[0])
        else:
            await self._ensure_policy_requirements(session)
            result = await self._run_model_turn(session, profile)

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
        if isinstance(result, ManifestDraftEnvelope):
            # Emit the fully-annotated canonical draft (AG-005) before the raw
            # manifest.proposed summary.
            canonical = self._draft_canonical(session, result, message)
            await self._append_event(
                session,
                "manifest.draft",
                canonical.model_dump(mode="json"),
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

    def _draft_canonical(
        self,
        session: AgentSession,
        envelope: ManifestDraftEnvelope,
        user_prompt: str,
    ) -> CanonicalManifest:
        """Synthesise the fully-annotated canonical manifest for a validated draft.

        The envelope has already passed ``validate_manifest_policy``; the
        drafter's own pre-flight is a redundant safety net, surfaced as a turn
        failure rather than silent acceptance.
        """
        context = DraftingContext(
            request_id=str(session.request_id),
            workspace_id=session.organization_id,
            user_prompt=user_prompt,
            policy=_policy_constraints(session.policy_requirements),
            cloud_default_region=_workspace_default_region(session),
        )
        try:
            return draft_manifest(envelope.data.manifest, context)
        except PolicyViolationError as error:
            raise InvalidModelResponseError(str(error)) from error

    async def _run_model_turn(
        self,
        session: AgentSession,
        profile: ProfileBundle,
    ) -> AgentOutputEnvelope:
        """Call the model, validate its envelope, and enforce policy on drafts."""
        try:
            augmented_profile = _augment_profile(profile, session.answered_questions)
            raw_output = await self._model.complete_turn(session, augmented_profile)
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
            if isinstance(result, ClarificationQuestionEnvelope) and (
                result.data.field_mapping in {a.field_mapping for a in session.answered_questions}
            ):
                raise InvalidModelResponseError("Agent output asked for an already answered field")
            if isinstance(result, ManifestDraftEnvelope):
                if session.policy_requirements is None:
                    raise InvalidModelResponseError(
                        "Manifest draft was produced before policy requirements were loaded"
                    )
                result = _apply_workspace_region_default(result, session)
                context_error = _manifest_cloud_context_error(
                    result.data.manifest, session.execution_context
                )
                if context_error:
                    raise InvalidModelResponseError(context_error)
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
        return result

    async def record_clarification_answers(
        self,
        *,
        session_id: str,
        answers: list[AnsweredQuestion],
    ) -> AgentSession:
        """Persist a batch of clarification answers into the session.

        Call this when the frontend submits answers to a ``clarification.required``
        event before the next ``run_turn``. Duplicate ``field_mapping`` entries are
        deduplicated (last value wins) to prevent state bloat.
        """
        session = await self._state.get_session(session_id)
        merged: dict[str, AnsweredQuestion] = {
            answer.field_mapping: answer for answer in session.answered_questions
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


def _policy_constraints(requirements: PolicyRequirements | None) -> PolicyConstraints:
    """Map resolved policy requirements onto the drafter's constraint object."""
    if requirements is None:
        return PolicyConstraints()
    return PolicyConstraints(
        allowed_regions=tuple(requirements.allowed_regions),
        max_budget=requirements.max_budget,
        required_tags=dict(requirements.required_tags),
        prohibited_resource_types=tuple(requirements.prohibited_resource_types),
    )


def _context_resolved_fields(context: ExecutionContext | None) -> frozenset[str]:
    """Fields the validated cloud context leaves no choice for, so never asked."""
    if context is None:
        return frozenset()
    resolved: set[str] = set()
    if len(context.cloud_context.connected_providers) == 1:
        resolved.add("provider")
    regions = _context_region_options(context, []) or []
    if context.cloud_context.default_region or len(regions) == 1:
        resolved.add("region")
    return frozenset(resolved)


def _unsupported_selected_provider(
    context: ExecutionContext | None,
    answered_questions: list[AnsweredQuestion],
    user_text: str,
) -> str | None:
    if context is None:
        return None
    connected = context.cloud_context.connected_providers
    selected = next(
        (
            answer.answer.strip().lower()
            for answer in reversed(answered_questions)
            if answer.field_mapping == "provider"
        ),
        None,
    )
    if selected is None:
        mentions = []
        for provider, patterns in (
            ("aws", (r"\baws\b",)),
            ("azure", (r"\bazure\b",)),
            ("gcp", (r"\bgcp\b", r"\bgoogle cloud\b")),
        ):
            if any(re.search(pattern, user_text, re.IGNORECASE) for pattern in patterns):
                mentions.append(provider)
        selected = mentions[0] if len(mentions) == 1 else None
    if selected is None and len(connected) == 1:
        selected = connected[0]
    if selected in connected and selected != "aws":
        return selected
    return None


def _context_region_options(
    context: ExecutionContext | None,
    answered_questions: list[AnsweredQuestion],
) -> list[str] | None:
    if context is None:
        return None
    provider = next(
        (
            answer.answer
            for answer in reversed(answered_questions)
            if answer.field_mapping == "provider"
        ),
        None,
    )
    account_regions = [
        region
        for account in context.cloud_context.active_accounts
        if provider is None or account.provider == provider
        for region in account.supported_regions
    ]
    regions = account_regions or context.cloud_context.regions
    if context.cloud_context.default_region:
        return list(dict.fromkeys([context.cloud_context.default_region, *regions]))
    return list(dict.fromkeys(regions)) or None


def _manifest_cloud_context_error(
    manifest: ResourceManifest,
    context: ExecutionContext | None,
) -> str | None:
    if context is None:
        return None
    cloud = context.cloud_context
    provider = manifest.provider
    if provider not in cloud.connected_providers:
        return "The proposed provider is not connected to this workspace."

    provider_regions = [
        region
        for account in cloud.active_accounts
        if account.provider == provider
        for region in account.supported_regions
    ]
    verified_regions = provider_regions or cloud.regions
    if verified_regions and manifest.region not in verified_regions:
        return "The proposed region is not verified for the connected workspace account."

    existing_names = {
        resource.name.casefold()
        for resource in cloud.existing_resources
        if resource.name
        and (resource.provider is None or resource.provider == provider)
        and (resource.region is None or resource.region == manifest.region)
    }
    if any(resource.name.casefold() in existing_names for resource in manifest.resources):
        return "The proposed manifest reuses a resource name that already exists in this workspace."

    for account in cloud.active_accounts:
        if account.provider != provider or account.quota_limits is None:
            continue
        for resource in manifest.resources:
            quota = account.quota_limits.get(resource.type)
            count = account.resource_counts.get(resource.type, 0) if account.resource_counts else 0
            requested = getattr(resource, "count", 1)
            if quota is not None and count + requested > quota:
                return "The proposed resource count exceeds a reported workspace quota."

    return None


def _apply_workspace_region_default(
    result: ManifestDraftEnvelope,
    session: AgentSession,
) -> ManifestDraftEnvelope:
    default_region = _workspace_default_region(session)
    if default_region is None:
        return result
    manifest = result.data.manifest.model_copy(update={"region": default_region})
    return result.model_copy(update={"data": result.data.model_copy(update={"manifest": manifest})})


def _workspace_default_region(session: AgentSession) -> str | None:
    context = session.execution_context
    if context is None or context.cloud_context.default_region is None:
        return None
    if any(answer.field_mapping == "region" for answer in session.answered_questions):
        return None
    user_text = "\n".join(
        message.content for message in session.messages if message.role == "user"
    )
    if re.search(r"\b(?:us|eu|ap|sa|ca|me|af)-[a-z]+-[0-9]\b", user_text):
        return None
    return context.cloud_context.default_region


_ANSWER_FIELD_TYPES: dict[ClarificationInputType, Literal["string", "strings", "boolean"]] = {
    "text": "string",
    "select": "string",
    "multi_select": "strings",
    "boolean": "boolean",
    "confirmation": "boolean",
}


def _answer_field(question: ClarificationQuestion) -> ClarificationAnswerField:
    """Describe the answer shape the orchestrator validates submitted answers against."""
    return ClarificationAnswerField(
        name=question.question_id,
        type=_ANSWER_FIELD_TYPES[question.input_type],
        options=tuple(question.options) or None,
    )


def _clarification_envelope(
    session: AgentSession,
    question: ClarificationQuestion,
) -> ClarificationQuestionEnvelope:
    """Build a clarification envelope for the highest-priority detected gap."""
    return ClarificationQuestionEnvelope(
        version="1.0.0",
        request_id=session.request_id,
        metadata=OutputMetadata(confidence=1.0, source="template"),
        type="clarification_question",
        data=ClarificationQuestionData(
            question=question.question_text,
            fields=(_answer_field(question),),
            question_id=question.question_id,
            input_type=question.input_type,
            options=tuple(question.options),
            required=question.required,
            field_mapping=question.field_mapping,
        ),
    )


def _augment_profile(
    profile: ProfileBundle,
    answered_questions: list[AnsweredQuestion],
) -> ProfileBundle:
    """Return the profile with confirmed-answers context prepended to its prompt.

    The prompt's ``content_hash`` is deliberately left untouched: this is a
    runtime augmentation, not a permanent bundle change, so the session's pinned
    hash integrity check still holds.
    """
    context_block = build_answered_context(answered_questions)
    if not context_block:
        return profile
    augmented_prompt = _augment_prompt(profile.prompt, context_block)
    return profile.model_copy(update={"prompt": augmented_prompt})


def _augment_prompt(prompt: PromptBundle, context_block: str) -> PromptBundle:
    augmented = prompt.model_copy()
    object.__setattr__(augmented, "content", context_block + prompt.content)
    return augmented


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
