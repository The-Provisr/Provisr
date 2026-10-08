"""HTTP adapter for the MCP policy server (port 5100)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

import httpx


@dataclass(frozen=True, slots=True)
class PolicyConstraints:
    """Structured policy constraints returned by the MCP policy server."""

    allowed_regions: tuple[str, ...] = field(default_factory=tuple)
    max_budget: float | None = None
    required_tags: dict[str, str] = field(default_factory=dict)
    prohibited_resource_types: tuple[str, ...] = field(default_factory=tuple)


class PolicyRequirementsTool(Protocol):
    """Protocol that any policy requirements provider must satisfy."""

    async def get_policy_requirements(
        self,
        workspace_id: str | UUID,
        *,
        context: dict[str, object] | None = None,
    ) -> PolicyConstraints: ...


class McpPolicyClient:
    """Calls http://mcp:5100/v1/policy/requirements and parses constraints.

    Instantiate once at startup and inject via ``create_resources``.
    """

    def __init__(
        self,
        base_url: str = "http://mcp:5100",
        timeout: float = 5.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def get_policy_requirements(
        self,
        workspace_id: str | UUID,
        *,
        context: dict[str, object] | None = None,
    ) -> PolicyConstraints:
        payload: dict[str, object] = {"workspace_id": str(workspace_id)}
        if context is not None:
            payload["context"] = context

        async with httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout) as client:
            response = await client.post("/v1/policy/requirements", json=payload)
            response.raise_for_status()
            data: dict[str, object] = response.json()

        return _parse_constraints(data)


class UnavailablePolicyRequirementsTool:
    """Stand-in used when no MCP client is configured.

    Raises ``RuntimeError`` so misconfiguration is immediately visible
    rather than silently skipping policy checks.
    """

    async def get_policy_requirements(
        self,
        workspace_id: str | UUID,
        *,
        context: dict[str, object] | None = None,
    ) -> PolicyConstraints:
        raise RuntimeError(
            "PolicyRequirementsTool is not configured. "
            "Set MCP_BASE_URL or inject a real McpPolicyClient."
        )


def _parse_constraints(data: dict[str, object]) -> PolicyConstraints:
    allowed_regions = tuple(
        str(r) for r in (data.get("allowed_regions") or []) if isinstance(r, str)
    )
    max_budget_raw = data.get("max_budget")
    max_budget = float(max_budget_raw) if isinstance(max_budget_raw, (int, float)) else None
    required_tags = {
        str(k): str(v)
        for k, v in (data.get("required_tags") or {}).items()
        if isinstance(k, str) and isinstance(v, str)
    }
    prohibited_resource_types = tuple(
        str(t) for t in (data.get("prohibited_resource_types") or []) if isinstance(t, str)
    )
    return PolicyConstraints(
        allowed_regions=allowed_regions,
        max_budget=max_budget,
        required_tags=required_tags,
        prohibited_resource_types=prohibited_resource_types,
    )
