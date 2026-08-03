import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Query, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import (
    AgentDispatcherDependency,
    AgentServiceDependency,
    StateStoreDependency,
)
from app.api.schemas import (
    AgentDispatchRequest,
    AgentDispatchResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    RunTurnRequest,
    RunTurnResponse,
)
from app.domain.errors import DispatchRunMismatchError
from app.domain.models import AgentEvent

router = APIRouter()


@router.get("/health/live", tags=["health"])
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", tags=["health"])
async def readiness(state: StateStoreDependency) -> dict[str, str]:
    return {"status": "ready" if await state.ready() else "not_ready"}


@router.post(
    "/runs/{run_id}/dispatch",
    response_model=AgentDispatchResponse,
    response_model_exclude_none=True,
    tags=["orchestrator"],
)
async def dispatch_run(
    run_id: UUID,
    body: AgentDispatchRequest,
    dispatcher: AgentDispatcherDependency,
) -> AgentDispatchResponse:
    if run_id != body.run_id:
        raise DispatchRunMismatchError("path run_id must match body run_id")
    return await dispatcher.dispatch(body)


@router.post(
    "/v1/sessions",
    response_model=CreateSessionResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["agent"],
)
async def create_session(
    body: CreateSessionRequest,
    service: AgentServiceDependency,
) -> CreateSessionResponse:
    session = await service.create_session(
        organization_id=body.organization_id,
        request_id=body.request_id,
        profile_id=body.profile_id,
        prompt_version=body.prompt_version,
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
) -> RunTurnResponse:
    result = await service.run_turn(session_id=session_id, message=body.message)
    return RunTurnResponse(result=result)


@router.get("/v1/sessions/{session_id}/events", tags=["events"])
async def stream_events(
    session_id: str,
    state: StateStoreDependency,
    after_sequence: int = Query(default=0, ge=0),
) -> StreamingResponse:
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
