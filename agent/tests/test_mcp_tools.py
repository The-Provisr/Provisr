import json
from uuid import uuid4

import httpx
import pytest

from app.api.schemas import AgentDispatchRequest
from app.integrations.mcp_tools import HttpReadOnlyToolClient


def dispatch_request(phase: str = "pending_policy") -> AgentDispatchRequest:
    return AgentDispatchRequest.model_validate(
        {
            "run_id": str(uuid4()),
            "session_id": str(uuid4()),
            "workspace_id": str(uuid4()),
            "user_id": str(uuid4()),
            "correlation_id": str(uuid4()),
            "phase": phase,
            "prompt": "Create an AWS web service",
        }
    )


@pytest.mark.anyio
async def test_mcp_call_is_authenticated_workspace_scoped_and_redacted() -> None:
    seen: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "ok": True,
                "tool": "get_policy_requirements",
                "result": {"rules": ["encrypt-storage"], "raw_policy": "secret"},
            },
        )

    dispatch = dispatch_request()
    client = HttpReadOnlyToolClient(
        policy_url="https://policy.test",
        cloud_url="https://cloud.test",
        timeout_seconds=2,
        service_auth_token="service-token",
        transport=httpx.MockTransport(handler),
    )
    result = await client.get_policy_requirements(dispatch)
    await client.aclose()

    assert result.ok is True
    assert result.provenance is not None
    assert result.provenance["evidence"] == {"rules": ["encrypt-storage"], "raw_policy": "[redacted]"}
    headers = seen["headers"]
    assert isinstance(headers, dict)
    assert headers["authorization"] == "Bearer service-token"
    body = seen["body"]
    assert isinstance(body, dict)
    assert body["context"]["workspace_id"] == str(dispatch.workspace_id)
    assert body["context"]["idempotency_key"] == f"read:get_policy_requirements:{dispatch.run_id}:pending_policy"


@pytest.mark.anyio
async def test_mcp_failure_fails_closed_without_exposing_response() -> None:
    client = HttpReadOnlyToolClient(
        policy_url="https://policy.test",
        cloud_url="https://cloud.test",
        timeout_seconds=2,
        transport=httpx.MockTransport(lambda request: httpx.Response(503, text="internal secret")),
    )
    result = await client.get_existing_resources(dispatch_request("pending_cloud_context"))
    await client.aclose()

    assert result.ok is False
    assert result.error_code == "MCP_REJECTED"
    assert "secret" not in (result.summary or "")
