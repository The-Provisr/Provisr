"""MCP-014: adapt persisted manifest IDs to private BE-D04 generation.

Validation and draft-version confirmation are checked against persisted run state
by the backend. This tool never runs Terraform or grants execution authority.
"""
from __future__ import annotations

import hashlib
from pathlib import PurePosixPath
from typing import Annotated, Literal, Self
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from src.context.fastapi import require_context
from src.context.models import MCPContext

router = APIRouter()
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class GenerateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context: MCPContext
    manifest_id: UUID


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class TerraformFile(StrictModel):
    path: str = Field(min_length=1, max_length=256)
    content: str = Field(max_length=4 * 1024 * 1024)

    @model_validator(mode="after")
    def safe_path(self) -> Self:
        path = PurePosixPath(self.path)
        if (path.is_absolute() or ".." in path.parts or "\\" in self.path
                or "\x00" in self.path or str(path) != self.path
                or path.suffix not in {".tf", ".tfvars"}):
            raise ValueError("Invalid Terraform artifact path")
        return self


class Summary(StrictModel):
    resource_count: int = Field(ge=1, le=1000)
    file_count: int = Field(ge=1, le=1000)


class IaCArtifact(StrictModel):
    iac_artifact_id: UUID
    manifest_id: UUID
    manifest_version: int = Field(ge=1)
    run_id: UUID
    workspace_id: UUID
    session_id: UUID
    terraform_files: list[TerraformFile] = Field(min_length=1, max_length=1000)
    file_list: list[str] = Field(min_length=1, max_length=1000)
    file_count: int = Field(ge=1, le=1000)
    total_size: int = Field(ge=1, le=4 * 1024 * 1024)
    hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    template_source: Literal["template"]
    summary: Summary

    @model_validator(mode="after")
    def verify_bundle(self) -> Self:
        paths = [file.path for file in self.terraform_files]
        if (paths != sorted(set(paths)) or paths != self.file_list
                or self.file_count != len(paths) or self.summary.file_count != len(paths)):
            raise ValueError("Artifact file metadata is inconsistent")
        required = {"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"}
        if not required.issubset(paths) or not any(path.startswith("resources/") for path in paths):
            raise ValueError("Incomplete Terraform module")
        size = sum(len(file.content.encode("utf-8")) for file in self.terraform_files)
        digest = hashlib.sha256()
        for file in self.terraform_files:
            digest.update(f"{file.path}\x00{file.content}\x00".encode())
        if self.total_size != size or self.hash != digest.hexdigest():
            raise ValueError("Artifact integrity verification failed")
        if UUID(int=0) in {self.iac_artifact_id, self.manifest_id, self.run_id,
                          self.workspace_id, self.session_id}:
            raise ValueError("Artifact identifiers must not be empty")
        return self


class Unsupported(StrictModel):
    logical_name: str = Field(pattern=r"^[a-z0-9_-]{1,64}$")
    type: str = Field(pattern=r"^[a-z0-9_.-]{1,128}$")
    status: Literal["unsupported"]


class UnsupportedResult(StrictModel):
    error: Literal["unsupported"]
    message: str
    unsupported: list[Unsupported] = Field(min_length=1, max_length=1000)


def unavailable() -> HTTPException:
    return HTTPException(status_code=502, detail="Terraform artifact generation unavailable")


@router.post("/tools/generate_iac", response_model=IaCArtifact)
async def generate_iac(
    request: Request,
    context: Annotated[MCPContext, Depends(require_context("iac:write", require_idempotency_key=True))],
) -> IaCArtifact:
    try:
        payload = GenerateInput.model_validate(await request.json())
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="A manifest ID and context are required") from exc
    if payload.manifest_id.int == 0:
        raise HTTPException(status_code=422, detail="A valid manifest ID is required")

    resources = request.app.state.resources
    token = resources.iac_service_token
    if not token:
        raise unavailable()
    try:
        async with resources.http_client.stream(
            "POST", f"{resources.manifest_backend_url}/v1/iac/generate",
            json={"manifest_id": str(payload.manifest_id), "context": context.model_dump(mode="json")},
            headers={"Authorization": f"Bearer {token}", "X-Request-ID": str(context.request_id),
                     "X-Correlation-ID": str(context.correlation_id),
                     "Idempotency-Key": context.idempotency_key or ""},
            timeout=10.0,
        ) as response:
            chunks = bytearray()
            async for chunk in response.aiter_bytes():
                chunks.extend(chunk)
                if len(chunks) > MAX_RESPONSE_BYTES:
                    raise unavailable()
            status = response.status_code
    except httpx.RequestError as exc:
        raise unavailable() from exc

    if status == 422:
        try:
            unsupported = UnsupportedResult.model_validate_json(chunks)
        except ValidationError:
            raise HTTPException(status_code=422, detail="Manifest cannot be rendered by reviewed templates") from None
        raise HTTPException(status_code=422, detail={
            "error": "unsupported", "message": "Manifest includes unsupported resource types",
            "unsupported": [item.model_dump() for item in unsupported.unsupported],
        })
    if status in {403, 404, 409}:
        messages = {403: "IaC generation not permitted", 404: "Manifest not found in run",
                    409: "Manifest or run changed; generation requires a validated, confirmed version and matching retry key"}
        raise HTTPException(status_code=status, detail=messages[status])
    if status != 200:
        raise unavailable()
    try:
        artifact = IaCArtifact.model_validate_json(chunks)
        if (artifact.manifest_id != payload.manifest_id or artifact.run_id != context.request_id
                or artifact.workspace_id != context.workspace_id or artifact.session_id != context.session_id):
            raise ValueError("Artifact context mismatch")
        return artifact
    except (ValidationError, ValueError) as exc:
        raise unavailable() from exc
