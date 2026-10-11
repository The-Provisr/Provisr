from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from app.policy.errors import PolicyRequirementsUnavailableError
from app.policy.models import PolicyRequirements

if TYPE_CHECKING:
    from app.domain.models import AgentSession


class PolicyRequirementsTool(Protocol):
    async def get_policy_requirements(self, session: AgentSession) -> PolicyRequirements: ...


class UnavailablePolicyRequirementsTool:
    """Fail-closed default until orchestration injects its MCP tool adapter."""

    async def get_policy_requirements(self, session: AgentSession) -> PolicyRequirements:
        raise PolicyRequirementsUnavailableError(
            "get_policy_requirements MCP tool is not configured"
        )
