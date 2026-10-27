"""MCP-015: plan only persisted, confirmed IaC through the provisioning worker."""
from __future__ import annotations

import asyncio
import re
from typing import Annotated, Literal, Self
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from src.context.models import MCPContext
from src.servers.iac_generation import authenticated_iac_context

router = APIRouter()
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
IAC_PLANNING_TIMEOUT_SECONDS = 110.0

# Parse module and instance indices before deciding whether a resource is data.
_IDENTIFIER = r"[A-Za-z_][A-Za-z0-9_-]*"
_INDEX = r'(?:\[(?:[0-9]+|"[A-Za-z0-9_.:/@ -]*")\])?'
_ADDRESS = re.compile(
    rf"^(?:module\.{_IDENTIFIER}{_INDEX}\.)*(?P<data>data\.)?"
    rf"(?P<resource_type>{_IDENTIFIER})\.{_IDENTIFIER}{_INDEX}$"
)


class CreatePlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    context: MCPContext
    iac_artifact_id: UUID


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ResourceChange(StrictModel):
    address: str = Field(min_length=1, max_length=1024, pattern=r'^[A-Za-z_][A-Za-z0-9_.\-\[\]":/@ ]*$')
    resource_type: str = Field(min_length=1, max_length=255, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    change_type: Literal["create", "update", "delete", "replace", "no-op", "read"]
    risk_tags: list[Literal["destructive", "public_exposure", "cost_impact"]] = Field(max_length=3)

    @model_validator(mode="after")
    def unique_tags(self) -> Self:
        if _ADDRESS.fullmatch(self.address) is None:
            raise ValueError("Invalid Terraform resource address")
        if len(set(self.risk_tags)) != len(self.risk_tags):
            raise ValueError("Duplicate plan risk tags")
        return self


class PlanSummary(StrictModel):
    create_count: int = Field(ge=0, le=10000)
    update_count: int = Field(ge=0, le=10000)
    delete_count: int = Field(ge=0, le=10000)
    unchanged_count: int = Field(ge=0, le=10000)
    resource_changes: list[ResourceChange] = Field(max_length=1000)

    @model_validator(mode="after")
    def consistent_counts(self) -> Self:
        addresses = [resource.address for resource in self.resource_changes]
        if len(addresses) != len(set(addresses)):
            raise ValueError("Duplicate plan resource addresses")
        counts = {"create": 0, "update": 0, "delete": 0, "no-op": 0}
        for resource in self.resource_changes:
            address = _ADDRESS.fullmatch(resource.address)
            if address is None:
                raise ValueError("Invalid Terraform resource address")
            if address.group("resource_type") != resource.resource_type:
                raise ValueError("Resource type does not match its address")
            if address.group("data") or resource.change_type == "read":
                continue
            if resource.change_type == "replace":
                counts["create"] += 1
                counts["delete"] += 1
            else:
                counts[resource.change_type] += 1
        if (self.create_count, self.update_count, self.delete_count, self.unchanged_count) != (
            counts["create"], counts["update"], counts["delete"], counts["no-op"],
        ):
            raise ValueError("Plan resource counts are inconsistent")
        return self


class PlanResult(StrictModel):
    plan_artifact_id: UUID
    iac_artifact_id: UUID
    manifest_id: UUID
    manifest_version: int = Field(ge=1)
    run_id: UUID
    workspace_id: UUID
    session_id: UUID
    hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    raw_plan_json_reference: str = Field(max_length=128)
    summary: PlanSummary

    @model_validator(mode="after")
    def verify_reference(self) -> Self:
        if UUID(int=0) in {
            self.plan_artifact_id, self.iac_artifact_id, self.manifest_id,
            self.run_id, self.workspace_id, self.session_id,
        }:
            raise ValueError("Plan identifiers must not be empty")
        if self.raw_plan_json_reference != f"db://provisr_iac/plans/{self.plan_artifact_id}/json":
            raise ValueError("Plan JSON reference does not match the stored plan")
        return self


def unavailable() -> HTTPException:
    return HTTPException(status_code=502, detail="Terraform planning unavailable")


@router.post("/tools/create_plan", response_model=PlanResult)
async def create_plan(
    request: Request,
    context: Annotated[MCPContext, Depends(authenticated_iac_context)],
) -> PlanResult:
    try:
        payload = CreatePlanInput.model_validate(await request.json())
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="A stored IaC artifact ID and context are required") from exc
    if payload.iac_artifact_id.int == 0:
        raise HTTPException(status_code=422, detail="A valid stored IaC artifact ID is required")

    resources = request.app.state.resources
    try:
        async with asyncio.timeout(IAC_PLANNING_TIMEOUT_SECONDS):
            async with resources.http_client.stream(
                "POST", f"{resources.provisioning_backend_url}/v1/iac/plans",
                json={"context": context.model_dump(mode="json"), "iac_artifact_id": str(payload.iac_artifact_id)},
                headers={
                    "Authorization": f"Bearer {resources.iac_service_token}",
                    "X-Request-ID": str(context.request_id),
                    "X-Correlation-ID": str(context.correlation_id),
                    "Idempotency-Key": context.idempotency_key or "",
                },
                timeout=IAC_PLANNING_TIMEOUT_SECONDS,
            ) as response:
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > MAX_RESPONSE_BYTES:
                        raise unavailable()
                status = response.status_code
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Terraform planning timed out; retry with the same key") from exc
    except httpx.RequestError as exc:
        raise unavailable() from exc

    errors = {
        403: "Terraform planning is not permitted",
        404: "IaC artifact was not found in this run",
        409: "Run or artifact changed; planning requires the confirmed version and matching retry key",
        422: "Terraform plan could not be created from the stored artifact",
    }
    if status in errors:
        raise HTTPException(status_code=status, detail=errors[status])
    if status != 200:
        raise unavailable()
    try:
        result = PlanResult.model_validate_json(chunks)
        if (result.iac_artifact_id != payload.iac_artifact_id or result.workspace_id != context.workspace_id
                or result.run_id != context.request_id or result.session_id != context.session_id):
            raise ValueError("Plan context mismatch")
        return result
    except (ValidationError, ValueError) as exc:
        raise unavailable() from exc
