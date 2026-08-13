from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.api.schemas import ProblemDetails
from app.domain.errors import (
    DependencyUnavailableError,
    DomainError,
    InvalidModelResponseError,
    ModelNotConfiguredError,
    SessionFailedError,
    SessionNotFoundError,
)
from app.prompts.errors import PromptIntegrityError


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def handle_domain_error(_: Request, error: DomainError) -> JSONResponse:
        response_status = _status_for(error)
        problem = ProblemDetails(
            type=f"urn:provisr:error:{error.code.lower()}",
            title=_title_for(error),
            status=response_status,
            detail=str(error),
            code=error.code,
        )
        return JSONResponse(status_code=response_status, content=problem.model_dump())


def _status_for(error: DomainError) -> int:
    if isinstance(error, SessionNotFoundError):
        return status.HTTP_404_NOT_FOUND
    if isinstance(error, SessionFailedError):
        return status.HTTP_409_CONFLICT
    if isinstance(error, (InvalidModelResponseError, DependencyUnavailableError)):
        return status.HTTP_502_BAD_GATEWAY
    if isinstance(error, ModelNotConfiguredError):
        return status.HTTP_503_SERVICE_UNAVAILABLE
    if isinstance(error, PromptIntegrityError):
        return status.HTTP_500_INTERNAL_SERVER_ERROR
    return status.HTTP_400_BAD_REQUEST


def _title_for(error: DomainError) -> str:
    if isinstance(error, SessionNotFoundError):
        return "Session not found"
    if isinstance(error, SessionFailedError):
        return "Session failed"
    if isinstance(error, InvalidModelResponseError):
        return "Invalid model response"
    if isinstance(error, ModelNotConfiguredError):
        return "Model not configured"
    if isinstance(error, DependencyUnavailableError):
        return "External dependency unavailable"
    if isinstance(error, PromptIntegrityError):
        return "Prompt integrity validation failed"
    return "Request failed"
