from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from pydantic import ValidationError

from app.policy.errors import PolicyRequirementsUnavailableError
from app.policy.models import PolicyRequirements

if TYPE_CHECKING:
    from app.domain.models import AgentSession


class MCPToolCaller(Protocol):
    async def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, object],
        session: AgentSession,
    ) -> object: ...


class MCPPolicyRequirementsTool:
    """Validated adapter from the generic MCP tool runner to AG-008 policy context."""

    def __init__(self, caller: MCPToolCaller) -> None:
        self._caller = caller

    async def get_policy_requirements(self, session: AgentSession) -> PolicyRequirements:
        raw = await self._caller.call_tool(
            "get_policy_requirements",
            {},
            session,
        )
        try:
            return PolicyRequirements.model_validate(raw)
        except ValidationError as error:
            raise PolicyRequirementsUnavailableError(
                "get_policy_requirements returned an invalid response"
            ) from error
