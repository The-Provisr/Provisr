from __future__ import annotations

from typing import Any, Protocol

import httpx

from app.api.schemas import AgentDispatchRequest, AgentToolCall


class ReadOnlyToolClient(Protocol):
    async def get_policy_requirements(self, request: AgentDispatchRequest) -> AgentToolCall: ...

    async def get_cloud_account_capabilities(self, request: AgentDispatchRequest) -> AgentToolCall: ...

    async def get_existing_resources(self, request: AgentDispatchRequest) -> AgentToolCall: ...

    async def aclose(self) -> None: ...


class HttpReadOnlyToolClient:
    """Read-only MCP HTTP adapter with a validated workspace context envelope."""

    def __init__(
        self,
        *,
        policy_url: str,
        cloud_url: str,
        timeout_seconds: float,
        service_auth_token: str = "",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._policy_url = policy_url.rstrip("/")
        self._cloud_url = cloud_url.rstrip("/")
        self._service_auth_token = service_auth_token
        self._client = httpx.AsyncClient(timeout=timeout_seconds, transport=transport)

    async def get_policy_requirements(self, request: AgentDispatchRequest) -> AgentToolCall:
        return await self._call(
            tool_name="get_policy_requirements",
            base_url=self._policy_url,
            permission="policy:read",
            request=request,
        )

    async def get_cloud_account_capabilities(self, request: AgentDispatchRequest) -> AgentToolCall:
        return await self._call(
            tool_name="get_cloud_account_capabilities",
            base_url=self._cloud_url,
            permission="cloud:read",
            request=request,
        )

    async def get_existing_resources(self, request: AgentDispatchRequest) -> AgentToolCall:
        return await self._call(
            tool_name="get_existing_resources",
            base_url=self._cloud_url,
            permission="cloud:read",
            request=request,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _call(
        self,
        *,
        tool_name: str,
        base_url: str,
        permission: str,
        request: AgentDispatchRequest,
    ) -> AgentToolCall:
        if not base_url:
            return _failed_tool(tool_name, "MCP_NOT_CONFIGURED", "Required MCP service is not configured.")

        payload: dict[str, object] = {
            "context": {
                "workspace_id": str(request.workspace_id),
                "user_id": str(request.user_id),
                "permissions": [permission],
                "request_id": str(request.run_id),
                "correlation_id": str(request.correlation_id),
                "session_id": str(request.session_id),
                "idempotency_key": f"read:{tool_name}:{request.run_id}:{request.phase}",
            },
            "args": {},
        }
        headers = {"x-provisr-service": "agent", "x-provisr-audience": "mcp"}
        if self._service_auth_token:
            headers["Authorization"] = f"Bearer {self._service_auth_token}"
        try:
            response = await self._client.post(f"{base_url}/tools/{tool_name}", json=payload, headers=headers)
        except httpx.TimeoutException:
            return _failed_tool(tool_name, "MCP_TIMEOUT", "Required MCP service timed out.")
        except httpx.HTTPError:
            return _failed_tool(tool_name, "MCP_UNAVAILABLE", "Required MCP service is unavailable.")

        if response.status_code >= 400:
            return _failed_tool(tool_name, "MCP_REJECTED", "Required MCP service rejected the request.")
        try:
            body = response.json()
        except ValueError:
            return _failed_tool(tool_name, "MCP_INVALID_RESPONSE", "Required MCP service returned an invalid response.")
        if not isinstance(body, dict) or body.get("tool") != tool_name or body.get("ok") is not True:
            return _failed_tool(tool_name, "MCP_INVALID_RESPONSE", "Required MCP service returned an invalid response.")

        summary = body.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            summary = f"{tool_name.replace('_', ' ').capitalize()} loaded."
        return AgentToolCall(
            tool_name=tool_name,
            ok=True,
            summary=summary,
            provenance={
                "source": "mcp",
                "tool": tool_name,
                "evidence": _redact(body.get("result")),
            },
        )


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

    async def aclose(self) -> None:
        return None


def _failed_tool(tool_name: str, error_code: str, summary: str) -> AgentToolCall:
    return AgentToolCall(tool_name=tool_name, ok=False, summary=summary, error_code=error_code)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[redacted]" if any(secret in str(key).lower() for secret in ("secret", "token", "password", "credential", "access_key", "raw_policy", "rego", "authorization", "cookie")) else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value
