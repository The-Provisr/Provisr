from __future__ import annotations

from typing import Protocol

from app.api.schemas import (
    AgentDispatchRequest,
    AgentDispatchResponse,
    AgentMessage,
    AgentQuestion,
    AgentStreamEvent,
    AgentToolCall,
)
from app.domain.errors import PhaseNotConfiguredError
from app.domain.service import AgentService
from app.integrations.checkpoints import CheckpointStore
from app.integrations.mcp_tools import ReadOnlyToolClient
from app.outputs.models import (
    AgentOutputEnvelope,
    AssistantMessageEnvelope,
    ClarificationQuestionEnvelope,
    ComponentPayloadEnvelope,
    ErrorEnvelope,
    ManifestDraftEnvelope,
    ToolSummaryEnvelope,
)


class AgentDispatcher(Protocol):
    async def dispatch(self, request: AgentDispatchRequest) -> AgentDispatchResponse: ...


class ModelAgentDispatcher:
    """Bounded graph dispatch for the permitted policy/context/planning phases.

    Policy and cloud evidence are read-only. The graph never executes IaC or
    advances the orchestration state machine; it only returns verified evidence
    and a canonical manifest candidate for the orchestrator to validate.
    """

    def __init__(
        self,
        service: AgentService,
        tools: ReadOnlyToolClient,
        checkpoints: CheckpointStore | None = None,
    ) -> None:
        self._service = service
        self._tools = tools
        self._checkpoints = checkpoints

    async def dispatch(self, request: AgentDispatchRequest) -> AgentDispatchResponse:
        events = [self._event("agent.status", phase=request.phase, state="active", label="Dispatch received")]
        if request.cancellation_requested:
            events.append(AgentStreamEvent(event_type="turn.cancelled", payload={"run_id": str(request.run_id)}))
            return AgentDispatchResponse(events=events)

        if request.phase == "pending_policy":
            policy = await self._tools.get_policy_requirements(request)
            events.append(self._event("agent.status", phase=request.phase, state="complete", label="Policy requirements loaded"))
            return AgentDispatchResponse(tool_calls=[policy], events=events)

        if request.phase == "pending_cloud_context":
            capabilities = await self._tools.get_cloud_account_capabilities(request)
            inventory = await self._tools.get_existing_resources(request)
            events.append(self._event("agent.status", phase=request.phase, state="complete", label="Cloud context loaded"))
            return AgentDispatchResponse(tool_calls=[capabilities, inventory], events=events)

        if request.phase != "pending_agent":
            raise PhaseNotConfiguredError(f"phase {request.phase} is not implemented by the agent graph")

        checkpoint_id = await self._resume_if_available(request, events)
        session = await self._service.create_session(
            organization_id=str(request.workspace_id), request_id=request.correlation_id
        )
        result = await self._service.run_turn(session_id=session.session_id, message=_prompt_from(request))
        response = _response_from(result)
        response.events = events
        response.checkpoint_id = checkpoint_id
        if response.question is not None:
            response.checkpoint_id = await self._save_checkpoint(request, response.question, events)
            return response
        if response.manifest_draft is not None:
            events.append(AgentStreamEvent(event_type="manifest.validated", payload={"source": "agent_manifest_candidate"}))
        events.append(self._event("agent.status", phase=request.phase, state="complete", label="Agent dispatch completed"))
        return response

    async def _resume_if_available(self, request: AgentDispatchRequest, events: list[AgentStreamEvent]) -> str | None:
        if self._checkpoints is None or request.question_answer is None:
            return None
        checkpoint = await self._checkpoints.load_latest(thread_id=str(request.run_id))
        if checkpoint is None:
            return None
        events.append(self._event("agent.status", phase=request.phase, state="active", label="Resuming saved clarification"))
        return checkpoint.checkpoint_id

    async def _save_checkpoint(self, request: AgentDispatchRequest, question: AgentQuestion, events: list[AgentStreamEvent]) -> str | None:
        if self._checkpoints is None:
            return None
        checkpoint = await self._checkpoints.save(
            thread_id=str(request.run_id),
            state={"phase": request.phase, "question": question.model_dump(mode="json")},
        )
        events.append(self._event("agent.status", phase=request.phase, state="complete", label="Clarification checkpoint saved"))
        return checkpoint.checkpoint_id

    @staticmethod
    def _event(event_type: str, **payload: str) -> AgentStreamEvent:
        return AgentStreamEvent(event_type=event_type, payload=payload)  # type: ignore[arg-type]


def _prompt_from(request: AgentDispatchRequest) -> str:
    history = "\n".join(f"{item.role}: {item.content}" for item in request.history if item.role != "system")
    answer = f"\nClarification answer: {request.question_answer}" if request.question_answer is not None else ""
    return f"{history}\nuser: {request.prompt}{answer}" if history else f"user: {request.prompt}{answer}"


def _response_from(result: AgentOutputEnvelope) -> AgentDispatchResponse:
    if isinstance(result, AssistantMessageEnvelope):
        return AgentDispatchResponse(messages=[AgentMessage(role="assistant", content=result.data.message)])
    if isinstance(result, ClarificationQuestionEnvelope):
        return AgentDispatchResponse(messages=[AgentMessage(role="assistant", content=result.data.question)], question=AgentQuestion(id=f"clarification-{result.request_id}", text=result.data.question))
    if isinstance(result, ManifestDraftEnvelope):
        return AgentDispatchResponse(messages=[AgentMessage(role="assistant", content=result.data.message)], manifest_draft=result.data.manifest.model_dump(mode="json"))
    if isinstance(result, ToolSummaryEnvelope):
        return AgentDispatchResponse(messages=[AgentMessage(role="assistant", content=result.data.summary)], tool_calls=[AgentToolCall(tool_name=result.data.tool_name, ok=True, summary=result.data.summary)])
    if isinstance(result, ComponentPayloadEnvelope):
        return AgentDispatchResponse(messages=[AgentMessage(role="assistant", content=f"Generated component {result.data.component_id}.")])
    if isinstance(result, ErrorEnvelope):
        return AgentDispatchResponse(messages=[AgentMessage(role="assistant", content=result.data.message)])
    raise TypeError("Unsupported agent output envelope")
