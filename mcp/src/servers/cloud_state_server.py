"""Read-only MCP-007 adapter for BE-B08's whitelisted capability API."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from src.context.errors import InvalidContextError
from src.context.fastapi import require_context
from src.context.models import MCPContext

router = APIRouter()
logger = logging.getLogger(__name__)


class AccountCapability(BaseModel):
    """Accept only safe typed fields; unrestricted upstream extras are discarded."""

    model_config = ConfigDict(strict=True)

    id: UUID
    provider: Literal["aws", "azure", "gcp"]
    status: Literal["pending", "active", "failed", "disconnected"]
    account_alias: str = Field(max_length=255)
    account_identity: str = Field(pattern=r"^(?:\*{8}[0-9]{4})?$")
    default_region: str
    available_regions: list[str]
    supported_domains: list[
        Literal[
            "compute",
            "database",
            "networking",
            "storage",
            "containers",
            "monitoring",
            "load_balancing",
        ]
    ]
    execution_ready: bool
    checked_at: datetime | None
    warning: (
        Literal[
            "account_not_verified",
            "provider_discovery_not_supported",
            "provider_discovery_unavailable",
            "execution_permissions_not_verified",
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def validate_readiness(self) -> AccountCapability:
        """Contradictory or stale readiness cannot be passed to the agent."""
        if any(not region.strip() for region in self.available_regions):
            raise ValueError("Empty capability region")
        if self.default_region and self.default_region not in self.available_regions:
            raise ValueError("Default region is not available")
        if self.checked_at is not None and (
            self.checked_at.tzinfo is None
            or self.checked_at > datetime.now(UTC) + timedelta(seconds=30)
        ):
            raise ValueError("Invalid discovery timestamp")
        if self.execution_ready and (
            self.status != "active"
            or not self.available_regions
            or not self.account_identity
            or self.checked_at is None
            or datetime.now(UTC) - self.checked_at > timedelta(hours=24)
            or self.warning is not None
        ):
            raise ValueError("Unverified execution readiness")
        return self


class CloudCapabilities(BaseModel):
    """Workspace binding is validated before any capability is returned."""

    model_config = ConfigDict(strict=True)
    workspace_id: UUID
    accounts: list[AccountCapability]


@router.post("/tools/get_cloud_account_capabilities")
async def get_cloud_account_capabilities(
    request: Request,
    context: MCPContext = Depends(require_context("cloud:read")),  # noqa: B008
) -> dict[str, object]:
    """Return verified capability facts without exposing raw account metadata."""
    payload = await request.json()
    if "workspace_id" in payload and payload["workspace_id"] != str(context.workspace_id):
        raise InvalidContextError(
            "Workspace does not match the context", request_id=context.request_id
        )
    resources = request.app.state.resources
    if not resources.cloud_service_token:
        raise HTTPException(status_code=503, detail="Cloud capabilities are not configured")
    url = f"{resources.cloud_backend_url}/v1/workspaces/{context.workspace_id}/cloud-capabilities"
    try:
        response = await resources.http_client.get(
            url,
            headers={
                "Authorization": f"Bearer {resources.cloud_service_token}",
                "X-Request-ID": str(context.request_id),
                "X-Correlation-ID": str(context.correlation_id),
            },
            timeout=15.0,
        )
        if response.status_code != 200:
            raise ValueError("Capability dependency unavailable")
        result = CloudCapabilities.model_validate_json(response.content)
        if result.workspace_id != context.workspace_id:
            raise ValueError("Capability workspace mismatch")
        if len({account.id for account in result.accounts}) != len(result.accounts):
            raise ValueError("Duplicate capability account")
    except (httpx.RequestError, ValueError, ValidationError) as error:
        logger.warning(
            "cloud_capabilities outcome=unavailable workspace_id=%s request_id=%s "
            "correlation_id=%s",
            context.workspace_id,
            context.request_id,
            context.correlation_id,
        )
        raise HTTPException(status_code=502, detail="Cloud capabilities are unavailable") from error
    logger.info(
        "cloud_capabilities outcome=success account_count=%d workspace_id=%s "
        "request_id=%s correlation_id=%s",
        len(result.accounts),
        context.workspace_id,
        context.request_id,
        context.correlation_id,
    )
    return {
        **result.model_dump(mode="json"),
        "warnings": (
            ["No active cloud providers are connected."]
            if not any(account.status == "active" for account in result.accounts)
            else []
        ),
    }
