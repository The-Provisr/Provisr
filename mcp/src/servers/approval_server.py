"""MCP-019 adapter for BE-E01's deterministic, audited approval rule engine."""

from __future__ import annotations

import logging
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

RiskLevel = Literal["low", "medium", "high", "critical"]
ApproverRole = Literal["admin", "security", "finance"]


class ResourceChange(BaseModel):
    """One planned change; BE-E01 normalizes case, defaults and ordering."""

    model_config = ConfigDict(extra="forbid", strict=True)

    address: str = Field(default="", max_length=1024)
    type: str = Field(min_length=1, max_length=255)
    action: str = Field(default="", max_length=32)
    public: bool = False
    properties: dict[str, object] | None = None


class CostEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    estimated_monthly_usd: float = Field(ge=0, allow_inf_nan=False)
    source: str = Field(default="", max_length=64)


class PolicyViolation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    rule_key: str = ""
    severity: str = ""
    description: str = ""
    evidence: str = ""
    remediation_hint: str = ""


class PolicyResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    decision: str = Field(min_length=1, max_length=32)
    violations: list[PolicyViolation] = Field(default_factory=list)


class ApprovalRequirementsRequest(BaseModel):
    """Run context only: workspace, user and role come from the validated envelope."""

    model_config = ConfigDict(extra="forbid", strict=True)

    context: dict[str, object]
    run_id: UUID | None = Field(default=None, strict=False)
    environment: str = Field(min_length=1, max_length=32)
    provider: str = Field(default="", max_length=32)
    region: str = Field(default="", max_length=64)
    public_exposure: bool = False
    resource_changes: list[ResourceChange] = Field(default_factory=list, max_length=1000)
    cost_estimate: CostEstimate
    policy: PolicyResult


class TriggeredRule(BaseModel):
    model_config = ConfigDict(strict=True)

    rule: Literal[
        "environment", "cost", "resource_type", "public_exposure", "policy_violation", "role"
    ]
    reason: str
    approver_role: ApproverRole
    risk_level: RiskLevel


class EvaluatedRequirement(BaseModel):
    """BE-E01 response; a decision without audit identity is never returned."""

    model_config = ConfigDict(strict=True)

    requires_approval: bool
    reason: str = Field(min_length=1)
    required_approver_role: ApproverRole | None
    risk_level: RiskLevel
    triggered_rules: list[TriggeredRule]
    rule_set_version: str = Field(min_length=1)
    input_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    evaluation_id: UUID = Field(strict=False)
    evaluated_at: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_consistency(self) -> EvaluatedRequirement:
        """Contradictory decisions cannot reach the agent or orchestration."""
        if self.requires_approval != bool(self.triggered_rules):
            raise ValueError("Approval decision does not match triggered rules")
        if self.requires_approval != (self.required_approver_role is not None):
            raise ValueError("Approval decision does not match approver role")
        if not self.requires_approval and self.risk_level != "low":
            raise ValueError("Unapproved run cannot carry elevated risk")
        if self.requires_approval and self.required_approver_role not in {
            rule.approver_role for rule in self.triggered_rules
        }:
            raise ValueError("Approver role is not backed by a triggered rule")
        return self


@router.post("/tools/get_approval_requirements")
async def get_approval_requirements(
    request: Request,
    context: MCPContext = Depends(require_context("approval:read")),  # noqa: B008
) -> dict[str, object]:
    """Return the deterministic approval requirement BE-E01 evaluated and audited."""
    try:
        body = ApprovalRequirementsRequest.model_validate(await request.json())
    except ValidationError as error:
        raise HTTPException(status_code=422, detail="Run context is invalid") from error

    resources = request.app.state.resources
    if not resources.approval_service_token:
        raise HTTPException(status_code=503, detail="Approval requirements are not configured")

    payload = body.model_dump(mode="json", exclude={"context"}, exclude_unset=True)
    payload["workspace_id"] = str(context.workspace_id)
    payload["user_id"] = str(context.user_id)
    log_fields = (context.workspace_id, body.run_id, context.request_id, context.correlation_id)
    try:
        response = await resources.http_client.post(
            f"{resources.approval_backend_url}/v1/approval-requirements/evaluate",
            json=payload,
            headers={
                "Authorization": f"Bearer {resources.approval_service_token}",
                "X-Request-ID": str(context.request_id),
                "X-Correlation-ID": str(context.correlation_id),
            },
            timeout=15.0,
        )
    except httpx.RequestError as error:
        _log_outcome("unavailable", *log_fields)
        raise HTTPException(
            status_code=502, detail="Approval requirements are unavailable"
        ) from error

    if response.status_code == 409:
        _log_outcome("policy_denied", *log_fields)
        raise HTTPException(
            status_code=409,
            detail="Policy decision is DENY; approval cannot override a denied run",
        )
    if response.status_code == 400:
        _log_outcome("rejected", *log_fields)
        raise HTTPException(status_code=422, detail="Run context is invalid")
    if response.status_code == 404:
        _log_outcome("not_member", *log_fields)
        raise InvalidContextError(
            "User does not belong to the requested workspace", request_id=context.request_id
        )
    try:
        if response.status_code != 200:
            raise ValueError("Approval dependency unavailable")
        result = EvaluatedRequirement.model_validate_json(response.content)
    except (ValueError, ValidationError) as error:
        _log_outcome("unavailable", *log_fields)
        raise HTTPException(
            status_code=502, detail="Approval requirements are unavailable"
        ) from error

    logger.info(
        "approval_requirements outcome=success requires_approval=%s risk_level=%s "
        "evaluation_id=%s workspace_id=%s run_id=%s request_id=%s correlation_id=%s",
        result.requires_approval,
        result.risk_level,
        result.evaluation_id,
        *log_fields,
    )
    return result.model_dump(mode="json")


def _log_outcome(
    outcome: str,
    workspace_id: UUID,
    run_id: UUID | None,
    request_id: UUID,
    correlation_id: UUID,
) -> None:
    logger.warning(
        "approval_requirements outcome=%s workspace_id=%s run_id=%s request_id=%s "
        "correlation_id=%s",
        outcome,
        workspace_id,
        run_id,
        request_id,
        correlation_id,
    )
