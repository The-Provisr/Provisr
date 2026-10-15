"""MCP-012 manifest drafting, policy enforcement, validation, and persistence."""
from __future__ import annotations

from copy import deepcopy
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from src.context.fastapi import require_context
from src.context.models import MCPContext

router = APIRouter()


@router.post("/tools/create_manifest")
async def create_manifest(
    request: Request,
    context: MCPContext = Depends(  # noqa: B008
        require_context("manifest:write", require_idempotency_key=True)
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

    manifest = _canonicalize_draft(deepcopy(draft))
    errors = _merge_and_check(manifest, policy if isinstance(policy, dict) else {}, cloud)
    if errors:
        return {"valid": False, "errors": errors}

    confidence, source = _agent_confidence(body.get("agent_output"))
    source_metadata: dict[str, Any] = {
        "fields": _field_sources(manifest, source, confidence),
        "clarifications": body.get("clarifications", []),
    }
    for resource in manifest.get("resources", []):
        if isinstance(resource, dict):
            resource.setdefault("source", {"source": source, "confidence": confidence})

    resources = request.app.state.resources
    run_id = str(context.request_id)
    base_url = resources.manifest_url.rstrip("/")
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
        validation = validation_response.json()
        if not validation.get("valid", False):
            return {"valid": False, "errors": validation.get("errors", [])}

        store_response = await resources.http_client.post(
            f"{base_url}/v1/runs/{quote(run_id, safe='')}/manifests",
            json={"content": manifest, "source_metadata": source_metadata},
            headers=headers,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Manifest service is unavailable") from exc
    if store_response.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Manifest could not be persisted")
    record = store_response.json()
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
    """Adapt the agent's draft envelope to BE-D01's provider-neutral shape."""
    if not isinstance(draft.get("resources"), list):
        return draft
    resources: list[Any] = []
    domain_by_kind = {
        "ec2": "compute", "vm": "compute", "compute": "compute",
        "s3": "storage", "bucket": "storage", "storage": "storage",
        "rds": "database", "database": "database", "vpc": "network",
        "network": "network", "lb": "network", "load_balancer": "network",
        "kms": "security", "iam": "security", "monitoring": "monitoring",
        "container": "container",
    }
    for item in draft["resources"]:
        if not isinstance(item, dict):
            resources.append(item)
            continue
        resource = dict(item)
        raw_type = resource.get("type")
        if isinstance(raw_type, str) and "." not in raw_type:
            parts = raw_type.lower().split("_", 1)
            if len(parts) == 2 and parts[0] in {"aws", "azure", "gcp"}:
                provider, kind = parts
                domain = domain_by_kind.get(kind, "compute")
                resource["type"] = f"{domain}.{provider}.{kind}"
        resource.setdefault("logical_name", resource.pop("name", ""))
        if not isinstance(resource.get("properties"), dict):
            resource["properties"] = {}
        for key in ("versioning", "engine", "instance_type", "instance_class", "count", "image"):
            if key in resource:
                resource["properties"].setdefault(key, resource.pop(key))
        if isinstance(resource.get("properties"), dict):
            resource["properties"].pop("source", None)
        resources.append(resource)
    draft["resources"] = resources
    draft.setdefault("schema_version", "1.0")
    draft.setdefault("unknowns", [])
    if "monthly_budget_usd" in draft and "cost_estimate" not in draft:
        draft["cost_estimate"] = {"estimated_monthly_usd": draft.pop("monthly_budget_usd")}
    if "security" in draft and isinstance(draft["security"], dict):
        security = draft.pop("security")
        if security.get("encryption_enabled"):
            for resource in resources:
                if isinstance(resource, dict):
                    settings = resource.get("security_settings")
                    if not isinstance(settings, dict):
                        settings = {}
                        resource["security_settings"] = settings
                    settings["encryption_enabled"] = True
    return draft


def _merge_and_check(manifest: dict[str, Any], policy: dict[str, Any], cloud: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    provider = manifest.get("provider")
    region = manifest.get("region")
    connected = cloud.get("providers", cloud.get("connected_providers", []))
    accounts = cloud.get("active_accounts", [])
    verified_providers = {
        item.get("provider") for item in accounts
        if isinstance(item, dict) and item.get("status") == "active" and item.get("verified_at")
    }
    if isinstance(connected, list) and connected:
        verified_providers.update(p for p in connected if isinstance(p, str))
    if not provider and len(verified_providers) == 1:
        manifest["provider"] = provider = next(iter(verified_providers))
    if not isinstance(provider, str) or provider not in verified_providers:
        errors.append("Manifest provider is not connected and verified for this workspace")

    default_region = cloud.get("default_region")
    regions = cloud.get("regions", [])
    if not isinstance(regions, list):
        regions = []
    if not regions:
        regions = [r for account in accounts if isinstance(account, dict)
                   for r in account.get("supported_regions", []) if isinstance(r, str)]
    if not region and isinstance(default_region, str) and default_region:
        manifest["region"] = default_region
        region = default_region
    if not region and _policies_enabled(policy) and isinstance(policy.get("allowed_regions"), list):
        allowed = policy["allowed_regions"]
        if len(allowed) == 1:
            manifest["region"] = region = allowed[0]
    if not isinstance(region, str) or (regions and region not in regions):
        errors.append("Manifest region is not among verified workspace regions")
    allowed_regions = policy.get("allowed_regions")
    if _policies_enabled(policy) and isinstance(allowed_regions, list) and region not in allowed_regions:
        errors.append("Manifest region is prohibited by workspace policy")

    resources = manifest.get("resources", [])
    if not isinstance(resources, list):
        return errors + ["Manifest resources must be a list"]
    if _policies_enabled(policy):
        tags = manifest.setdefault("tags", {})
        required_tags = policy.get("required_tags", [])
        if isinstance(required_tags, dict):
            required_tags = list(required_tags)
        for key in required_tags:
            if isinstance(key, str) and (not isinstance(tags, dict) or not str(tags.get(key, "")).strip()):
                errors.append(f"Required policy tag is missing: {key}")
        if policy.get("required_encryption"):
            for index, resource in enumerate(resources):
                if isinstance(resource, dict):
                    security = resource.setdefault("security_settings", {})
                    if isinstance(security, dict):
                        security["encryption_enabled"] = True
        prohibited = set(policy.get("prohibited_resource_types", []))
        for index, resource in enumerate(resources):
            if isinstance(resource, dict) and resource.get("type") in prohibited:
                errors.append(f"resources[{index}].type is prohibited by workspace policy")
        budget = policy.get("max_monthly_budget_usd", policy.get("max_budget"))
        estimate = manifest.get("cost_estimate")
        if isinstance(budget, (int, float)) and (
            not isinstance(estimate, dict)
            or not isinstance(estimate.get("estimated_monthly_usd"), (int, float))
            or estimate["estimated_monthly_usd"] > budget
        ):
            errors.append("Manifest cost estimate is missing or exceeds workspace policy")
    return errors


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
