"""MCP-028: authenticated, stateless monitoring fragment tools."""

from fastapi import APIRouter, Depends, Request

from src.context.fastapi import require_context
from src.context.models import MCPContext
from src.domain.monitoring import (
    MonitoringGenerationResult,
    MonitoringValidationResult,
    generate_monitoring_manifest,
    validate_monitoring_request,
)

router = APIRouter()


@router.post("/tools/generate_monitoring_manifest", response_model=MonitoringGenerationResult)
async def generate_monitoring(
    request: Request,
    context: MCPContext = Depends(require_context("manifest:write")),  # noqa: B008
) -> dict[str, object]:
    return generate_monitoring_manifest((await request.json()).get("requirements"))


@router.post("/tools/validate_monitoring_request", response_model=MonitoringValidationResult)
async def validate_monitoring(
    request: Request,
    context: MCPContext = Depends(require_context("manifest:write")),  # noqa: B008
) -> dict[str, object]:
    return validate_monitoring_request((await request.json()).get("fragment"))
