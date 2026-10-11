from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
import pytest
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


EVALUATED_AT = "2026-10-11T09:30:00.123456789Z"

DENY_VIOLATION = {
    "rule_key": "security.no_public_s3",
    "severity": "deny",
    "description": "Deny S3 buckets with public ACLs",
    "evidence": 'S3 bucket "assets" has public ACL "public-read"',
    "remediation_hint": "Set the S3 bucket ACL to private or use bucket policies.",
}
APPROVAL_VIOLATION = {
    "rule_key": "cost.max_monthly_budget",
    "severity": "approval",
    "description": "Warn when estimated monthly cost exceeds budget",
    "evidence": "Estimated monthly cost $2500.00 exceeds budget $1000.00",
    "remediation_hint": "Review resource sizing or request a budget increase.",
}
WARN_VIOLATION = {
    "rule_key": "compliance.required_tags",
    "severity": "warn",
    "description": "Require specific tags on all resources",
    "evidence": 'Resource "assets" is missing required tag "Owner"',
    "remediation_hint": "Add the required tags to the resource configuration.",
}

MANIFEST_PAYLOAD: dict[str, Any] = {
    "region": "us-east-1",
    "resources": [
        {"id": "assets", "type": "aws_s3_bucket", "properties": {"acl": "public-read"}},
    ],
}
PLAN_PAYLOAD: dict[str, Any] = {
    "resource_changes": [
        {
            "type": "aws_s3_bucket",
            "name": "assets",
            "change": {"after": {"acl": "public-read"}},
        },
    ],
}


def evaluation_response(
    decision: str,
    violations: list[dict[str, str]] | None,
) -> dict[str, Any]:
    return {
        "decision": decision,
        "violations": violations,
        "policies_evaluated": 6,
        "evaluated_at": EVALUATED_AT,
    }


def call_check_policy(
    handler: Any,
    body: dict[str, Any],
    membership_store: FakeMembershipStore | None = None,
) -> tuple[httpx.Response, list[httpx.Request]]:
    captured_requests: list[httpx.Request] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return handler(request)

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(mock_handler))
    app = create_app(
        membership_store=membership_store or FakeMembershipStore(),
        http_client=mock_client,
        backend_url="http://mock-backend:8081",
    )
    with TestClient(app) as client:
        response = client.post("/tools/check_policy", json=body)
    return response, captured_requests


def respond_with(status_code: int = 200, **kwargs: Any) -> Any:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, **kwargs)

    return handler


def check_policy_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "context": valid_context_payload(),
        "check_type": "manifest",
        "payload": MANIFEST_PAYLOAD,
    }
    body.update(overrides)
    return body


def assert_failed_closed(response: httpx.Response, status_code: int, error: str) -> None:
    assert response.status_code == status_code
    data = response.json()
    assert "decision" not in data
    assert "ALLOW" not in response.text
    assert data["detail"]["error"] == error
    assert data["detail"]["message"]
    assert data["detail"]["correlation_id"] == str(CORRELATION_ID)


@pytest.mark.parametrize(
    ("decision", "violations"),
    [
        ("ALLOW", []),
        ("WARN", [WARN_VIOLATION]),
        ("DENY", [DENY_VIOLATION, WARN_VIOLATION]),
        ("REQUIRES_APPROVAL", [APPROVAL_VIOLATION]),
    ],
)
def test_check_policy_returns_backend_decision(
    decision: str,
    violations: list[dict[str, str]],
) -> None:
    response, requests = call_check_policy(
        respond_with(json=evaluation_response(decision, violations)),
        check_policy_body(),
    )

    assert response.status_code == 200
    assert response.json() == {
        "decision": decision,
        "violations": violations,
        "evaluated_at": EVALUATED_AT,
    }
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("check_type", "payload"),
    [("manifest", MANIFEST_PAYLOAD), ("plan", PLAN_PAYLOAD)],
)
def test_check_policy_forwards_request_to_backend(
    check_type: str,
    payload: dict[str, Any],
) -> None:
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("DENY", [DENY_VIOLATION])),
        check_policy_body(check_type=check_type, payload=payload),
    )

    assert response.status_code == 200
    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert req.url == "http://mock-backend:8081/v1/policies/evaluate"
    assert req.headers["X-Request-ID"] == str(REQUEST_ID)
    assert req.headers["X-Correlation-ID"] == str(CORRELATION_ID)
    assert json.loads(req.content) == {
        "workspace_id": str(WORKSPACE_ID),
        "check_type": check_type,
        "input": payload,
    }


def test_check_policy_normalizes_null_violations() -> None:
    response, _ = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", None)),
        check_policy_body(),
    )

    assert response.status_code == 200
    assert response.json()["decision"] == "ALLOW"
    assert response.json()["violations"] == []


def test_check_policy_sets_evaluated_at_when_backend_omits_it() -> None:
    response, _ = call_check_policy(
        respond_with(json={"decision": "WARN", "violations": [WARN_VIOLATION]}),
        check_policy_body(),
    )

    assert response.status_code == 200
    evaluated_at = datetime.fromisoformat(response.json()["evaluated_at"])
    assert evaluated_at.utcoffset() == timedelta(0)


def test_check_policy_requires_context() -> None:
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", [])),
        {"check_type": "manifest", "payload": MANIFEST_PAYLOAD},
    )

    assert response.status_code == 403
    assert response.json()["error"] == "invalid_context"
    assert requests == []


def test_check_policy_forbidden_without_policy_read() -> None:
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", [])),
        check_policy_body(context=valid_context_payload(permissions=["workspace:read"])),
    )

    assert response.status_code == 403
    assert response.json()["error"] == "invalid_context"
    assert requests == []


def test_check_policy_forbidden_for_non_member() -> None:
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", [])),
        check_policy_body(),
        membership_store=FakeMembershipStore(role=None),
    )

    assert response.status_code == 403
    assert requests == []


@pytest.mark.parametrize("check_type", ["apply", "MANIFEST", "", None, 1, ["manifest"]])
def test_check_policy_rejects_invalid_check_type(check_type: object) -> None:
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", [])),
        check_policy_body(check_type=check_type),
    )

    assert_failed_closed(response, 422, "invalid_check_type")
    assert requests == []


def test_check_policy_rejects_missing_check_type() -> None:
    body = check_policy_body()
    del body["check_type"]
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", [])),
        body,
    )

    assert_failed_closed(response, 422, "invalid_check_type")
    assert requests == []


@pytest.mark.parametrize("payload", [[MANIFEST_PAYLOAD], '{"resources": []}', 42, True, None])
def test_check_policy_rejects_non_object_payload(payload: object) -> None:
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", [])),
        check_policy_body(payload=payload),
    )

    assert_failed_closed(response, 422, "invalid_payload")
    assert requests == []


def test_check_policy_rejects_missing_payload() -> None:
    body = check_policy_body()
    del body["payload"]
    response, requests = call_check_policy(
        respond_with(json=evaluation_response("ALLOW", [])),
        body,
    )

    assert_failed_closed(response, 422, "invalid_payload")
    assert requests == []


def test_check_policy_fails_closed_on_backend_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    response, requests = call_check_policy(handler, check_policy_body())

    assert_failed_closed(response, 504, "policy_service_timeout")
    assert len(requests) == 1


def test_check_policy_fails_closed_on_connection_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    response, _ = call_check_policy(handler, check_policy_body())

    assert_failed_closed(response, 502, "policy_service_unavailable")


@pytest.mark.parametrize("status_code", [400, 404, 500, 503])
def test_check_policy_fails_closed_on_backend_error_status(status_code: int) -> None:
    response, _ = call_check_policy(
        # A non-success status is an error even if the body looks like a decision.
        respond_with(status_code, json=evaluation_response("ALLOW", [])),
        check_policy_body(),
    )

    assert_failed_closed(response, 502, "policy_service_error")


@pytest.mark.parametrize(
    "backend_response",
    [
        {"text": "<html>bad gateway</html>"},
        {"content": b""},
        {"json": [evaluation_response("ALLOW", [])]},
        {"json": "ALLOW"},
        {"json": {"decision": "ALLOW", "violations": "none"}},
        {"json": {"decision": "ALLOW", "violations": ["security.no_public_s3"]}},
        {"json": {"decision": "ALLOW", "violations": [{"rule_key": "security.no_public_s3"}]}},
        {"json": {"decision": "ALLOW", "violations": [{**DENY_VIOLATION, "evidence": 7}]}},
    ],
)
def test_check_policy_fails_closed_on_malformed_body(backend_response: dict[str, Any]) -> None:
    response, _ = call_check_policy(respond_with(**backend_response), check_policy_body())

    assert_failed_closed(response, 502, "policy_service_malformed_response")


@pytest.mark.parametrize(
    "backend_body",
    [
        {"decision": "PERMIT", "violations": []},
        {"decision": "WAIVED", "violations": []},
        {"decision": "allow", "violations": []},
        {"decision": "", "violations": []},
        {"decision": None, "violations": []},
        {"decision": ["DENY"], "violations": []},
        {"violations": []},
        {},
    ],
)
def test_check_policy_fails_closed_on_unknown_decision(backend_body: dict[str, Any]) -> None:
    response, _ = call_check_policy(respond_with(json=backend_body), check_policy_body())

    assert response.status_code == 502
    data = response.json()
    assert "decision" not in data
    assert data["detail"]["error"] == "policy_decision_unrecognised"
    assert data["detail"]["correlation_id"] == str(CORRELATION_ID)


def test_check_policy_logs_decision_without_payload(caplog: pytest.LogCaptureFixture) -> None:
    payload = {"resources": [{"id": "customer-secret-bucket", "type": "aws_s3_bucket"}]}

    with caplog.at_level(logging.INFO, logger="src.servers.policy_server"):
        response, _ = call_check_policy(
            respond_with(json=evaluation_response("DENY", [DENY_VIOLATION, DENY_VIOLATION])),
            check_policy_body(payload=payload),
        )

    assert response.status_code == 200
    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "src.servers.policy_server"
    ]
    assert len(messages) == 1
    assert "decision=DENY" in messages[0]
    assert "rule_keys=['security.no_public_s3']" in messages[0]
    assert str(CORRELATION_ID) in messages[0]
    assert "customer-secret-bucket" not in caplog.text
    assert DENY_VIOLATION["evidence"] not in caplog.text


def test_check_policy_logs_failure_with_correlation_id(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="src.servers.policy_server"):
        response, _ = call_check_policy(
            respond_with(500, text="internal error"),
            check_policy_body(),
        )

    assert response.status_code == 502
    assert "error=policy_service_error" in caplog.text
    assert str(CORRELATION_ID) in caplog.text
