from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
from fastapi.testclient import TestClient

from src.servers.policy_server import create_app

WORKSPACE_ID = UUID("05a0cb9b-6793-4d47-ac80-c37916dc7b57")
USER_ID = UUID("fb352dce-57ea-47ad-a0d3-849d9888a313")
REQUEST_ID = UUID("e160fe9a-20b0-4a53-b7a4-af4acd899895")
CORRELATION_ID = UUID("0bc6e45b-4038-47d1-b392-eab5016356ef")
SESSION_ID = UUID("030aa973-4357-412f-98d1-7288a27f4bf7")


def valid_context_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "workspace_id": str(WORKSPACE_ID),
        "user_id": str(USER_ID),
        "permissions": ["policy:read"],
        "request_id": str(REQUEST_ID),
        "correlation_id": str(CORRELATION_ID),
        "session_id": str(SESSION_ID),
    }
    payload.update(overrides)
    return payload


class FakeMembershipStore:
    def __init__(self, role: str | None = "engineer") -> None:
        self.role = role
        self.calls: list[tuple[UUID, UUID]] = []

    async def get_role(self, *, user_id: UUID, workspace_id: UUID) -> str | None:
        self.calls.append((user_id, workspace_id))
        return self.role


def test_get_policy_requirements_success() -> None:
    captured_requests: list[httpx.Request] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(
            200,
            json={
                "has_policies": True,
                "policy_count": 2,
                "allowed_regions": ["ap-southeast-1"],
                "max_monthly_budget_usd": 500.0,
                "required_tags": ["environment"],
                "prohibited_resource_types": [],
                "required_encryption": True,
            },
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(mock_handler))
    app = create_app(
        membership_store=FakeMembershipStore(),
        http_client=mock_client,
        backend_url="http://mock-backend:8081",
    )

    with TestClient(app) as client:
        response = client.post(
            "/tools/get_policy_requirements",
            json={"context": valid_context_payload()},
        )

    assert response.status_code == 200
    data: dict[str, Any] = response.json()
    assert data["has_policies"] is True
    assert data["enabled"] is True
    assert data["max_budget"] == 500.0
    assert data["allowed_regions"] == ["ap-southeast-1"]

    assert len(captured_requests) == 1
    req = captured_requests[0]
    assert req.url == f"http://mock-backend:8081/v1/workspaces/{WORKSPACE_ID}/policy-requirements"
    assert req.headers["X-Request-ID"] == str(REQUEST_ID)
    assert req.headers["X-Correlation-ID"] == str(CORRELATION_ID)


def test_get_policy_requirements_requires_context() -> None:
    app = create_app(membership_store=FakeMembershipStore())
    with TestClient(app) as client:
        response = client.post("/tools/get_policy_requirements", json={})
    assert response.status_code == 403


def test_get_policy_requirements_forbidden_without_policy_read() -> None:
    app = create_app(membership_store=FakeMembershipStore())
    with TestClient(app) as client:
        response = client.post(
            "/tools/get_policy_requirements",
            json={"context": valid_context_payload(permissions=["workspace:read"])},
        )
    assert response.status_code == 403


def test_get_policy_requirements_handles_backend_error() -> None:
    def mock_handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="internal error")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(mock_handler))
    app = create_app(
        membership_store=FakeMembershipStore(),
        http_client=mock_client,
        backend_url="http://mock-backend:8081",
    )

    with TestClient(app) as client:
        response = client.post(
            "/tools/get_policy_requirements",
            json={"context": valid_context_payload()},
        )

    assert response.status_code == 502
    assert "Backend policy service returned error" in response.json()["detail"]
