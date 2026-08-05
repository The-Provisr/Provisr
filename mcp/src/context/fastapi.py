from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Protocol, cast
from uuid import UUID

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from src.context.errors import InvalidContextError
from src.context.membership import MembershipStore
from src.context.models import MCPContext
from src.context.validator import validate_context


class ContextResources(Protocol):
    membership_store: MembershipStore


def install_context_error_handler(app: FastAPI) -> None:
    @app.exception_handler(InvalidContextError)
    async def handle_invalid_context(
        _: Request,
        error: InvalidContextError,
    ) -> JSONResponse:
        response = error.as_response()
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content=response.model_dump(mode="json"),
        )


def require_context(
    required_permission: str,
    *,
    require_idempotency_key: bool = False,
) -> Callable[[Request], Awaitable[MCPContext]]:
    """Create a FastAPI dependency that validates a nested ``context`` envelope."""

    async def dependency(request: Request) -> MCPContext:
        payload = await _read_json_object(request)
        raw_context = payload.get("context")
        request_id = _extract_request_id(raw_context)

        try:
            context = MCPContext.model_validate(raw_context)
        except ValidationError as error:
            raise InvalidContextError(
                "Context envelope is missing or invalid",
                request_id=request_id,
            ) from error

        resources = cast(ContextResources, request.app.state.resources)
        return await validate_context(
            context,
            required_permission=required_permission,
            membership_store=resources.membership_store,
            require_idempotency_key=require_idempotency_key,
        )

    return dependency


async def _read_json_object(request: Request) -> Mapping[str, Any]:
    try:
        payload = await request.json()
    except (UnicodeDecodeError, ValueError) as error:
        raise InvalidContextError("Context envelope is missing or invalid") from error

    if not isinstance(payload, Mapping):
        raise InvalidContextError("Context envelope is missing or invalid")
    return payload


def _extract_request_id(raw_context: object) -> UUID | None:
    if not isinstance(raw_context, Mapping):
        return None
    raw_request_id = raw_context.get("request_id")
    try:
        return UUID(str(raw_request_id))
    except (TypeError, ValueError, AttributeError):
        return None
