import hmac
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import AgentServiceDependency, StateStoreDependency
from app.api.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    PolicyViolationExplanationRequest,
    PolicyViolationExplanationResponse,
    RunTurnRequest,
    RunTurnResponse,
)
from app.domain.models import AgentEvent
from app.policy.explanation import explain_policy_violation

router = APIRouter()


@router.post(
    "/v1/policy/violations/explain",
    response_model=PolicyViolationExplanationResponse,
    tags=["policy"],
)
async def explain_violation(
    body: PolicyViolationExplanationRequest,
    request: Request,
) -> PolicyViolationExplanationResponse:
    require_orchestrator(request)
    return PolicyViolationExplanationResponse.model_validate(
        explain_policy_violation(
            rule_key=body.rule_key,
            severity=body.severity,
            evidence=body.evidence,
            remediation_hint=body.remediation_hint,
        )
    )


def require_orchestrator(request: Request) -> None:
    token = request.app.state.settings.orchestrator_service_token
    if not token or not hmac.compare_digest(
        request.headers.get("authorization", ""), f"Bearer {token}"
    ):
        raise HTTPException(status_code=401, detail="Orchestration authorization required")


@router.get("/health/live", tags=["health"])
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", tags=["health"])
async def readiness(state: StateStoreDependency) -> dict[str, str]:
    return {"status": "ready" if await state.ready() else "not_ready"}


@router.post(
    "/v1/sessions",
    response_model=CreateSessionResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["agent"],
)
async def create_session(
    body: CreateSessionRequest,
    service: AgentServiceDependency,
    request: Request,
) -> CreateSessionResponse:
    if body.execution_context is not None:
        require_orchestrator(request)
    session = await service.create_session(
        organization_id=body.organization_id,
        request_id=body.request_id,
        profile_id=body.profile_id,
        prompt_version=body.prompt_version,
        execution_context=body.execution_context,
    )
    return CreateSessionResponse(session=session)


@router.post(
    "/v1/sessions/{session_id}/turns",
    response_model=RunTurnResponse,
    tags=["agent"],
)
async def run_turn(
    session_id: str,
    body: RunTurnRequest,
    service: AgentServiceDependency,
    state: StateStoreDependency,
    request: Request,
) -> RunTurnResponse:
    session = await state.get_session(session_id)
    if session.execution_context is not None:
        require_orchestrator(request)
    if body.answers:
        await service.record_clarification_answers(
            session_id=session_id,
            answers=body.answers,
        )
    result = await service.run_turn(session_id=session_id, message=body.message)
    return RunTurnResponse(result=result)


@router.get("/v1/sessions/{session_id}/events", tags=["events"])
async def stream_events(
    session_id: str,
    state: StateStoreDependency,
    request: Request,
    after_sequence: int = Query(default=0, ge=0),
) -> StreamingResponse:
    session = await state.get_session(session_id)
    if session.execution_context is not None:
        require_orchestrator(request)
    events = await state.list_events(session_id, after_sequence)
    return StreamingResponse(
        _encode_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _encode_events(events: list[AgentEvent]) -> AsyncIterator[str]:
    for event in events:
        yield (
            f"id: {event.sequence}\n"
            f"event: {event.type}\n"
            f"data: {json.dumps(event.model_dump(mode='json'), separators=(',', ':'))}\n\n"
        )
