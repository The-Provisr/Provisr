from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import asyncpg
import httpx
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, ValidationError

from src.context.fastapi import install_context_error_handler, require_context
from src.context.membership import MembershipStore, PostgresMembershipStore
from src.context.models import MCPContext
from src.servers.manifest_validation import validate_contextual_manifest

logger = logging.getLogger(__name__)

BACKEND_TIMEOUT_SECONDS = 5.0
router = APIRouter()


class ManifestValidationError(BaseModel):
    model_config = ConfigDict(strict=True)

    field: str
    code: str
    message: str
    allowed_values: list[Any] | None = None


class ManifestValidationResult(BaseModel):
    valid: bool
    errors: list[ManifestValidationError]


class ManifestValidationUnavailableError(Exception):
    """Validation could not be performed; says nothing about the manifest itself."""


class _MalformedResponseError(Exception):
    pass


@dataclass(slots=True)
class Resources:
    membership_store: MembershipStore
    http_client: httpx.AsyncClient
    manifest_backend_url: str


async def validate_manifest(
    manifest: Mapping[str, Any],
    context: MCPContext,
    *,
    http_client: httpx.AsyncClient,
    backend_url: str,
) -> ManifestValidationResult:
    """Validate a manifest against the backend schema validator (BE-D01).

    Returns the backend verdict, valid or not. Raises
    ``ManifestValidationUnavailableError`` when no verdict could be obtained.
    """

    headers = {
        "X-Request-ID": str(context.request_id),
        "X-Correlation-ID": str(context.correlation_id),
    }
    url = f"{backend_url.rstrip('/')}/v1/manifests/validate"
    try:
        response = await http_client.post(
            url,
            json=dict(manifest),
            headers=headers,
            timeout=BACKEND_TIMEOUT_SECONDS,
        )
    except httpx.TimeoutException as exc:
        raise _unavailable(context, "backend manifest validator timed out") from exc
    except httpx.RequestError as exc:
        raise _unavailable(
            context,
            f"failed to connect to backend manifest validator ({type(exc).__name__})",
        ) from exc

    if response.status_code != 200:
        # The backend body is not echoed: it may quote manifest content.
        raise _unavailable(
            context,
            f"backend manifest validator returned status {response.status_code}",
        )

    try:
        result = _parse_validation_result(response.json())
    except (ValueError, ValidationError, _MalformedResponseError) as exc:
        raise _unavailable(
            context,
            "backend manifest validator returned a malformed response",
        ) from exc

    logger.info(
        "validate_manifest outcome=%s error_count=%d "
        "workspace_id=%s request_id=%s correlation_id=%s",
        "valid" if result.valid else "invalid",
        len(result.errors),
        context.workspace_id,
        context.request_id,
        context.correlation_id,
    )
    return result


def _parse_validation_result(data: object) -> ManifestValidationResult:
    if not isinstance(data, dict):
        raise _MalformedResponseError("validation response must be a JSON object")
    valid = data.get("valid")
    if not isinstance(valid, bool):
        raise _MalformedResponseError("validation response must contain a boolean valid field")
    # The backend omits errors when there are none.
    raw_errors = data.get("errors")
    if raw_errors is None:
        raw_errors = []
    if not isinstance(raw_errors, list):
        raise _MalformedResponseError("validation response errors must be a list")
    errors = [ManifestValidationError.model_validate(raw_error) for raw_error in raw_errors]
    if valid == bool(errors):
        raise _MalformedResponseError("validation response valid flag contradicts its errors")
    return ManifestValidationResult(valid=valid, errors=errors)


def _unavailable(context: MCPContext, reason: str) -> ManifestValidationUnavailableError:
    logger.warning(
        "validate_manifest outcome=unavailable reason=%s "
        "workspace_id=%s request_id=%s correlation_id=%s",
        reason,
        context.workspace_id,
        context.request_id,
        context.correlation_id,
    )
    return ManifestValidationUnavailableError(reason)


def create_app(
    membership_store: MembershipStore | None = None,
    http_client: httpx.AsyncClient | None = None,
    backend_url: str | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        pool: asyncpg.Pool | None = None
        resolved_store = membership_store
        if resolved_store is None:
            pool = await asyncpg.create_pool(
                dsn=os.getenv(
                    "DATABASE_URL",
                    "postgres://localhost:5432/provisr?sslmode=disable",
                ),
                min_size=1,
                max_size=5,
                command_timeout=5,
            )
            resolved_store = PostgresMembershipStore(pool)

        client = http_client or httpx.AsyncClient()
        resolved_backend_url = (
            backend_url or os.getenv("MANIFEST_SERVICE_URL", "http://localhost:8090")
        ).rstrip("/")

        application.state.resources = Resources(
            membership_store=resolved_store,
            http_client=client,
            manifest_backend_url=resolved_backend_url,
        )
        try:
            yield
        finally:
            if http_client is None:
                await client.aclose()
            if pool is not None:
                await pool.close()

    application = FastAPI(
        title="Provisr MCP - Manifest Server",
        lifespan=lifespan,
    )
    install_context_error_handler(application)
    application.include_router(router)

    @application.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/health/ready")
    async def ready() -> dict[str, str]:
        return {"status": "ok"}

    return application


@router.post("/tools/validate_manifest")
async def validate_manifest_tool(
    request: Request,
    context: MCPContext = Depends(require_context("manifest:read")),  # noqa: B008
) -> ManifestValidationResult:
    resources = request.app.state.resources
    payload = await request.json()
    manifest = payload.get("manifest")
    if not isinstance(manifest, dict):
        raise HTTPException(
            status_code=422, detail="manifest is required and must be a JSON object"
        )

    # OR-012 sends the current ResourceManifest draft plus cloud/policy context.
    # Preserve its schema and contextual guards before projecting into BE-D01's
    # canonical wire format. The submitted draft itself is never changed.
    if "cloud_context" in payload or "policy_context" in payload:
        errors = validate_contextual_manifest(
            manifest,
            payload.get("cloud_context"),
            payload.get("policy_context"),
            str(context.workspace_id),
        )
        if errors:
            return ManifestValidationResult(
                valid=False,
                errors=[
                    ManifestValidationError(field="manifest", code="invalid_draft", message=error)
                    for error in errors
                ],
            )
        manifest = _backend_manifest(manifest)

    try:
        return await validate_manifest(
            manifest,
            context,
            http_client=resources.http_client,
            backend_url=resources.manifest_backend_url,
        )
    except ManifestValidationUnavailableError as exc:
        raise HTTPException(
            status_code=502, detail="Manifest validation could not be performed"
        ) from exc


def _backend_manifest(draft: dict[str, Any]) -> dict[str, Any]:
    """Read-only projection of a schema-checked OR-012 draft into BE-D01."""
    types = {
        "aws_ec2": "compute.aws.instance",
        "aws_rds": "database.aws.rds",
        "aws_s3": "storage.aws.s3",
    }
    return {
        "schema_version": draft.get("schema_version", "1.0"),
        "provider": draft.get("provider", "aws"),
        "region": draft["region"],
        "environment": draft["environment"],
        "tags": draft.get("tags", {}),
        "resources": [
            {
                # Logical identifiers are not cloud names: e.g. S3 permits dots,
                # while BE-D01 logical names do not. Preserve the cloud name below.
                "logical_name": f"resource_{index}",
                "type": types[resource["type"]],
                "properties": {k: v for k, v in resource.items() if k != "type"},
                "security_settings": draft["security"],
                "tags": draft.get("tags", {}),
            }
            for index, resource in enumerate(draft["resources"])
        ],
    }


app = create_app()
