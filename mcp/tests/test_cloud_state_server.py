"""MCP-007 contract regressions against the BE-B08 capability wire format."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from src.servers.policy_server import create_app

WORKSPACE = str(uuid4())
CONTEXT = {
    "workspace_id": WORKSPACE,
    "user_id": str(uuid4()),
    "request_id": str(uuid4()),
    "correlation_id": str(uuid4()),
    "session_id": str(uuid4()),
    "permissions": ["cloud:read"],
}
ACCOUNT = {
    "id": str(uuid4()),
    "provider": "aws",
    "status": "active",
    "account_alias": "Dev",
    "account_identity": "********9012",
    "default_region": "us-east-1",
    "available_regions": ["us-east-1"],
    "supported_domains": ["compute", "network", "storage"],
    "execution_ready": True,
    "checked_at": datetime.now(UTC).isoformat(),
}


class Membership:
    """Provide membership independently of caller-supplied permissions."""

    def __init__(self, member=True):
        self.member = member

    async def get_role(self, *, user_id, workspace_id):
        return "engineer" if self.member else None


def call_backend(body, backend_body=None, *, status=200, member=True, token="test-service-token"):
    """Exercise the actual mounted runtime route and record outgoing backend calls."""
    requests = []

    def respond(request):
        requests.append(request)
        if isinstance(backend_body, Exception):
            raise backend_body
        return httpx.Response(
            status, json=backend_body or {"workspace_id": WORKSPACE, "accounts": []}
        )

    runtime = create_app(
        membership_store=Membership(member),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        cloud_backend_url="http://cloud:8089",
        cloud_service_token=token,
    )
    with TestClient(runtime) as client:
        response = client.post("/tools/get_cloud_account_capabilities", json=body)
    return response, requests


def test_real_contract_forwards_trace_and_service_auth_but_filters_metadata():
    account = {**ACCOUNT, "metadata": {"secret": "DO_NOT_COPY"}}
    response, requests = call_backend(
        {"context": CONTEXT}, {"workspace_id": WORKSPACE, "accounts": [account]}
    )
    assert response.status_code == 200
    assert response.json()["accounts"][0]["execution_ready"] is True
    assert "DO_NOT_COPY" not in response.text
    assert requests[0].url == f"http://cloud:8089/v1/workspaces/{WORKSPACE}/cloud-capabilities"
    assert requests[0].headers["Authorization"] == "Bearer test-service-token"
    assert requests[0].headers["X-Correlation-ID"] == CONTEXT["correlation_id"]


def test_empty_workspace_has_actionable_warning():
    response, _ = call_backend({"context": CONTEXT})
    assert response.status_code == 200
    assert response.json()["accounts"] == []
    assert response.json()["warnings"]


@pytest.mark.parametrize(
    "body,member",
    [
        ({}, True),
        ({"context": {**CONTEXT, "permissions": ["policy:read"]}}, True),
        ({"context": CONTEXT}, False),
        ({"context": CONTEXT, "workspace_id": str(uuid4())}, True),
    ],
)
def test_invalid_scope_never_calls_backend(body, member):
    response, requests = call_backend(body, member=member)
    assert response.status_code == 403
    assert response.json()["error"] == "invalid_context"
    assert requests == []


@pytest.mark.parametrize(
    "change",
    [
        {"account_identity": "123456789012"},
        {"execution_ready": "true"},
        {"checked_at": None},
        {"status": "pending"},
        {"available_regions": []},
        {"checked_at": (datetime.now(UTC) - timedelta(days=2)).isoformat()},
        {"checked_at": (datetime.now(UTC) + timedelta(days=2)).isoformat()},
        {"default_region": "foreign"},
        {"supported_domains": ["unknown"]},
    ],
)
def test_malformed_or_contradictory_capabilities_fail_closed(change):
    response, _ = call_backend(
        {"context": CONTEXT}, {"workspace_id": WORKSPACE, "accounts": [{**ACCOUNT, **change}]}
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Cloud capabilities are unavailable"


def test_foreign_workspace_and_duplicate_accounts_fail_closed():
    for result in [
        {"workspace_id": str(uuid4()), "accounts": []},
        {"workspace_id": WORKSPACE, "accounts": [ACCOUNT, ACCOUNT]},
    ]:
        response, _ = call_backend({"context": CONTEXT}, result)
        assert response.status_code == 502


@pytest.mark.parametrize("failure", ["http", "timeout", "connect"])
def test_backend_failures_never_echo_upstream_secrets(failure):
    body = {"secret": "DO_NOT_COPY"}
    if failure == "timeout":
        body = httpx.ReadTimeout("DO_NOT_COPY")
    elif failure == "connect":
        body = httpx.ConnectError("DO_NOT_COPY")
    response, _ = call_backend({"context": CONTEXT}, body, status=500)
    assert response.status_code == 502
    assert "DO_NOT_COPY" not in response.text


def test_missing_service_authentication_does_not_call_backend():
    response, requests = call_backend({"context": CONTEXT}, token="")
    assert response.status_code == 503
    assert requests == []


def test_stale_regions_are_rejected_even_when_execution_is_not_ready():
    account={**ACCOUNT,"execution_ready":False,"warning":"execution_permissions_not_verified","checked_at":(datetime.now(UTC)-timedelta(days=2)).isoformat()}
    response,_=call_backend({"context":CONTEXT},{"workspace_id":WORKSPACE,"accounts":[account]})
    assert response.status_code==502


def test_fresh_regions_remain_usable_when_permissions_are_unverified():
    account={**ACCOUNT,"execution_ready":False,"warning":"execution_permissions_not_verified"}
    response,_=call_backend({"context":CONTEXT},{"workspace_id":WORKSPACE,"accounts":[account]})
    assert response.status_code==200
    assert response.json()["accounts"][0]["execution_ready"] is False
