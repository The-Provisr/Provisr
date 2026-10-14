"""MCP-012/013: validate drafts without mutating cloud or run state."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from jsonschema import Draft202012Validator

from src.context.fastapi import require_context
from src.context.models import MCPContext

router = APIRouter()
# Mirrors agent.app.domain.manifest.ANY_TAG_VALUE: the key is required, any
# non-blank value is accepted, and the placeholder itself is never a value.
ANY_TAG_VALUE = "*"
# Generated from agent.app.domain.manifest.ResourceManifest; checked for drift in tests.
_schema = json.loads(Path(__file__).with_name("manifest.schema.json").read_text())
_validator = Draft202012Validator(_schema)


def validate_schema(manifest: object) -> list[str]:
    return [
        f"{'.'.join(str(p) for p in error.path) or 'manifest'}: {error.validator} validation failed"
        for error in _validator.iter_errors(manifest)
    ]


def validate_contextual_manifest(
    manifest: dict[str, Any], cloud: object, policy: object, workspace_id: str
) -> list[str]:
    errors = validate_schema(manifest)
    if errors:
        return errors
    if not isinstance(cloud, dict) or not isinstance(policy, dict):
        return ["Validated cloud and policy context are required"]
    accounts = cloud.get("active_accounts", [])
    if not isinstance(accounts, list):
        return ["Cloud context must contain an account list"]
    provider = manifest.get("provider", "aws")
    if not any(
        isinstance(a, dict)
        and a.get("workspace_id") == workspace_id
        and a.get("status") == "active"
        and a.get("verified_at")
        and a.get("provider") == provider
        and isinstance(a.get("supported_regions"), list)
        and manifest["region"] in a["supported_regions"]
        for a in accounts
    ):
        errors.append("Provider and region must belong to a verified active workspace account")
    if policy.get("enabled") is not False:
        # The orchestrator snapshot uses [] for "no region rule"; a rule that
        # allows no regions fails pre-flight and never reaches validation.
        allowed_regions = policy.get("allowed_regions", [])
        if allowed_regions and manifest["region"] not in allowed_regions:
            errors.append("Region is prohibited by workspace policy")
        budget = policy.get("max_budget")
        if budget is not None and (
            manifest.get("monthly_budget_usd") is None or manifest["monthly_budget_usd"] > budget
        ):
            errors.append("Monthly budget exceeds workspace policy or is missing")
        required_tags = policy.get("required_tags", {})
        if not isinstance(required_tags, dict):
            return ["Policy context must contain a required tags map"]
        tags = manifest.get("tags", {})
        if any(
            not _tag_satisfies(tags.get(k), v) for k, v in required_tags.items()
        ) or ANY_TAG_VALUE in (str(v).strip() for v in tags.values()):
            errors.append("Required policy tags are missing")
        if policy.get("required_encryption") and not manifest["security"]["encryption_enabled"]:
            errors.append("Workspace policy requires encryption")
        if policy.get("required_backup") and not manifest["backup"]["enabled"]:
            errors.append("Workspace policy requires backups")
        if any(r["type"] in policy.get("prohibited_resource_types", []) for r in manifest["resources"]):
            errors.append("Manifest contains a prohibited resource type")
    return errors


@router.post("/tools/validate_manifest_schema")
async def validate_manifest_schema(
    request: Request,
    context: MCPContext = Depends(require_context("manifest:write")),  # noqa: B008
) -> dict[str, object]:
    body = await request.json()
    errors = validate_schema(body.get("manifest"))
    return {"valid": not errors, "errors": errors}


def _tag_satisfies(actual: object, required: object) -> bool:
    if required == ANY_TAG_VALUE:
        return isinstance(actual, str) and actual.strip() not in ("", ANY_TAG_VALUE)
    return actual == required
