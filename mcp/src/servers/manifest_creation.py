"""MCP-012 manifest drafting, policy enforcement, validation, and persistence."""
from __future__ import annotations

from copy import deepcopy
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from src.context.fastapi import require_context
from src.context.models import MCPContext
from src.servers.manifest_server import (
    _backend_manifest,
    _MalformedResponseError,
    _parse_validation_result,
)
from src.servers.manifest_validation import validate_contextual_manifest

router = APIRouter()


@router.post("/tools/create_manifest")
async def create_manifest(
    request: Request,
    context: MCPContext = Depends(
        require_context("manifest:write", require_idempotency_key=True)  # noqa: B008
    ),
) -> dict[str, Any]:
    body = await request.json()
    draft = body.get("agent_output")
    if isinstance(draft, dict) and isinstance(draft.get("manifest"), dict):
        draft = draft["manifest"]
    if not isinstance(draft, dict):
        raise HTTPException(status_code=422, detail="agent_output must contain a manifest object")

    policy = body.get("policy_requirements")
    cloud = body.get("cloud_context")
    enabled = body.get("policies_enabled", _policies_enabled(policy))
    if enabled and (not isinstance(policy, dict) or not policy):
        raise HTTPException(status_code=422, detail="policy_requirements are required when policies are enabled")
    if not isinstance(cloud, dict):
        raise HTTPException(status_code=422, detail="cloud_context is required")

    errors = validate_contextual_manifest(draft, cloud, policy, str(context.workspace_id))
    if errors:
        return {"valid": False, "errors": errors}
    manifest = _canonicalize_draft(deepcopy(draft))

    source, confidence = _agent_confidence(body.get("agent_output"))
    source_metadata: dict[str, Any] = {
        "fields": _field_sources(manifest, source, confidence),
        "clarifications": body.get("clarifications", []),
    }
    for resource in manifest.get("resources", []):
        if isinstance(resource, dict):
            resource.setdefault("source", {"source": source, "confidence": confidence})

    resources = request.app.state.resources
    run_id = str(context.request_id)
    base_url = resources.manifest_backend_url.rstrip("/")
    headers = {
        "Content-Type": "application/json",
        "X-Request-ID": str(context.request_id),
        "X-Correlation-ID": str(context.correlation_id),
        "Idempotency-Key": context.idempotency_key or "",
    }
    try:
        validation_response = await resources.http_client.post(
            f"{base_url}/v1/manifests/validate", json=manifest, headers=headers
        )
        if validation_response.status_code != 200:
            raise HTTPException(status_code=502, detail="Manifest validator is unavailable")
        validation = _parse_validation_result(validation_response.json())
        if not validation.valid:
            return {"valid": False, "errors": [error.model_dump() for error in validation.errors]}

        store_response = await resources.http_client.post(
            f"{base_url}/v1/runs/{quote(run_id, safe='')}/manifests",
            json={"content": manifest, "source_metadata": source_metadata},
            headers=headers,
        )
    except (httpx.RequestError, ValueError, _MalformedResponseError) as exc:
        raise HTTPException(status_code=502, detail="Manifest service is unavailable") from exc
    if store_response.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Manifest could not be persisted")
    try:
        record = store_response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Manifest service returned an invalid record") from exc
    if not isinstance(record, dict):
        raise HTTPException(status_code=502, detail="Manifest service returned an invalid record")
    version = record.get("version")
    manifest_id = record.get("id")
    if not isinstance(version, int) or not isinstance(manifest_id, str):
        raise HTTPException(status_code=502, detail="Manifest service returned an invalid record")
    return {
        "manifest_id": manifest_id,
        "version": version,
        "url": f"{base_url}/v1/runs/{quote(run_id, safe='')}/manifests/{version}",
        "validation": {"valid": True},
    }


def _policies_enabled(policy: object) -> bool:
    if not isinstance(policy, dict):
        return False
    return bool(policy.get("enabled", policy.get("has_policies", False)))


def _canonicalize_draft(draft: dict[str, Any]) -> dict[str, Any]:
    """Reuse the schema-checked projection without dropping resource properties."""
    return _backend_manifest(draft)


def _agent_confidence(output: object) -> tuple[str, float]:
    metadata = output.get("metadata") if isinstance(output, dict) else None
    if not isinstance(metadata, dict):
        return "ai_assumption", 0.5
    confidence = metadata.get("confidence", 0.5)
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        confidence = 0.5
    confidence = min(1.0, max(0.0, float(confidence)))
    source = metadata.get("source")
    return ("user_prompt" if source == "user_input" else "ai_assumption"), confidence


def _field_sources(manifest: dict[str, Any], source: str, confidence: float) -> dict[str, dict[str, Any]]:
    return {key: {"source": source, "confidence": confidence} for key in manifest if key != "resources"} | {
        f"resources[{index}]": {"source": source, "confidence": confidence}
        for index, _ in enumerate(manifest.get("resources", []))
    }
