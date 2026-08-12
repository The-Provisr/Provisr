from __future__ import annotations

from typing import Protocol

from app.api.schemas import AgentDispatchRequest, AgentToolCall


class ReadOnlyToolClient(Protocol):
    async def get_policy_requirements(self, request: AgentDispatchRequest) -> AgentToolCall: ...

    async def get_cloud_account_capabilities(self, request: AgentDispatchRequest) -> AgentToolCall: ...

    async def get_existing_resources(self, request: AgentDispatchRequest) -> AgentToolCall: ...


class DeterministicReadOnlyToolClient:
    """Fail-closed, credential-free evidence facade for the graph runtime."""

    async def get_policy_requirements(self, request: AgentDispatchRequest) -> AgentToolCall:
        return AgentToolCall(
            tool_name="get_policy_requirements",
            ok=True,
            summary="Workspace policy requirements loaded.",
            provenance={"workspace_id": str(request.workspace_id), "source": "policy"},
        )

    async def get_cloud_account_capabilities(self, request: AgentDispatchRequest) -> AgentToolCall:
        return AgentToolCall(
            tool_name="get_cloud_account_capabilities",
            ok=True,
            summary="Cloud account capabilities loaded without credentials.",
            provenance={"workspace_id": str(request.workspace_id), "source": "cloud_context"},
        )

    async def get_existing_resources(self, request: AgentDispatchRequest) -> AgentToolCall:
        return AgentToolCall(
            tool_name="get_existing_resources",
            ok=True,
            summary="Existing resource inventory loaded without credentials.",
            provenance={"workspace_id": str(request.workspace_id), "source": "cloud_context"},
        )
