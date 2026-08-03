from typing import Protocol

from app.api.schemas import (
    AgentDispatchRequest,
    AgentDispatchResponse,
    AgentMessage,
    AgentQuestion,
    AgentToolCall,
)
from app.domain.errors import PhaseNotConfiguredError
from app.domain.service import AgentService
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
    """Adapts the orchestrator run contract to the pinned-profile agent service.

    The dispatcher deliberately supports only ``pending_agent``. Earlier policy
    and cloud-context phases remain owned by their dedicated destination services
    and therefore fail closed here.
    """

    def __init__(self, service: AgentService) -> None:
        self._service = service

    async def dispatch(self, request: AgentDispatchRequest) -> AgentDispatchResponse:
        if request.phase != "pending_agent":
            raise PhaseNotConfiguredError(
                f"phase {request.phase} is not implemented by the manifest-only agent"
            )

        session = await self._service.create_session(
            organization_id=str(request.workspace_id),
            request_id=request.correlation_id,
        )
        result = await self._service.run_turn(
            session_id=session.session_id,
            message=_prompt_from(request),
        )
        return _response_from(result)


def _prompt_from(request: AgentDispatchRequest) -> str:
    history = "\n".join(
        f"{message.role}: {message.content}"
        for message in request.history
        if message.role in {"user", "assistant"}
    )
    answer = (
        f"\nClarification answer: {request.question_answer}"
        if request.question_answer is not None
        else ""
    )
    return f"{history}\nuser: {request.prompt}{answer}" if history else f"user: {request.prompt}{answer}"


def _response_from(result: AgentOutputEnvelope) -> AgentDispatchResponse:
    if isinstance(result, AssistantMessageEnvelope):
        return AgentDispatchResponse(messages=[AgentMessage(role="assistant", content=result.data.message)])
    if isinstance(result, ClarificationQuestionEnvelope):
        return AgentDispatchResponse(
            messages=[AgentMessage(role="assistant", content=result.data.question)],
            question=AgentQuestion(id=f"clarification-{result.request_id}", text=result.data.question),
        )
    if isinstance(result, ManifestDraftEnvelope):
        return AgentDispatchResponse(
            messages=[AgentMessage(role="assistant", content=result.data.message)],
            manifest_draft=result.data.manifest.model_dump(mode="json"),
        )
    if isinstance(result, ToolSummaryEnvelope):
        return AgentDispatchResponse(
            messages=[AgentMessage(role="assistant", content=result.data.summary)],
            tool_calls=[AgentToolCall(tool_name=result.data.tool_name, ok=True, summary=result.data.summary)],
        )
    if isinstance(result, ComponentPayloadEnvelope):
        return AgentDispatchResponse(
            messages=[
                AgentMessage(
                    role="assistant",
                    content=f"Generated component {result.data.component_id}.",
                )
            ]
        )
    if isinstance(result, ErrorEnvelope):
        return AgentDispatchResponse(
            messages=[AgentMessage(role="assistant", content=result.data.message)]
        )
    raise TypeError("Unsupported agent output envelope")
