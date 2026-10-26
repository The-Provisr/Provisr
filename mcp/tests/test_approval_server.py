"""MCP-019 contract regressions against the BE-E01 approval rule engine wire format."""

import json
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from src.servers.policy_server import create_app

WORKSPACE = str(uuid4())
USER = str(uuid4())
RUN = str(uuid4())
DIGEST = "a" * 64
CONTEXT = {
    "workspace_id": WORKSPACE,
    "user_id": USER,
    "request_id": str(uuid4()),
    "correlation_id": str(uuid4()),
    "session_id": str(uuid4()),
    "permissions": ["approval:read"],
}
RUN_CONTEXT = {
    "run_id": RUN,
    "environment": "dev",
    "provider": "aws",
    "region": "us-east-1",
    "public_exposure": False,
    "resource_changes": [{"address": "aws_instance.web", "type": "aws_instance"}],
    "cost_estimate": {"estimated_monthly_usd": 42.5},
    "policy": {"decision": "ALLOW", "violations": []},
}


def rule(name, reason, approver, risk):
    return {"rule": name, "reason": reason, "approver_role": approver, "risk_level": risk}


def evaluated(*rules, risk=None, approver=None):
    """Build a BE-E01 EvaluateResponse with its audit identity."""
    return {
        "requires_approval": bool(rules),
        "reason": "; ".join(r["reason"] for r in rules) or "no approval rules matched",
        "required_approver_role": approver,
        "risk_level": risk or "low",
        "triggered_rules": list(rules),
        "rule_set_version": "be-e01.v1",
        "input_digest": DIGEST,
        "config": {"cost_threshold_usd": 500},
        "cost_source": "manifest_estimate",
        "evaluation_id": str(uuid4()),
        "evaluated_at": "2026-10-21T00:00:00Z",
    }


class Membership:
    def __init__(self, member=True):
        self.member = member
        self.calls = 0

    async def get_role(self, *, user_id, workspace_id):
        self.calls += 1
        return "engineer" if self.member else None


def call(body, backend_body=None, *, status=200, member=True, token="test-service-token",
         authorization="Bearer test-service-token", membership=None):
    """Exercise the mounted runtime route and record outgoing backend calls."""
    requests = []

    def respond(request):
        requests.append(request)
        if isinstance(backend_body, Exception):
            raise backend_body
        if isinstance(backend_body, bytes):
            return httpx.Response(status, content=backend_body)
        return httpx.Response(status, json=backend_body or evaluated())

    runtime = create_app(
        membership_store=membership if membership is not None else Membership(member),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        approval_backend_url="http://approval:8084",
        approval_service_token=token,
    )
    with TestClient(runtime) as client:
        response = client.post(
            "/tools/get_approval_requirements", json=body,
            headers={} if authorization is None else {"Authorization": authorization},
        )
    return response, requests


def run_body(**overrides):
    return {"context": CONTEXT, **RUN_CONTEXT, **overrides}


def test_forwards_run_context_with_identity_from_envelope_and_service_auth():
    response, requests = call(run_body())
    assert response.status_code == 200
    sent = requests[0]
    assert sent.method == "POST"
    assert sent.url == "http://approval:8084/v1/approval-requirements/evaluate"
    assert sent.headers["Authorization"] == "Bearer test-service-token"
    assert sent.headers["X-Request-ID"] == CONTEXT["request_id"]
    assert sent.headers["X-Correlation-ID"] == CONTEXT["correlation_id"]
    forwarded = json.loads(sent.content)
    assert forwarded["workspace_id"] == WORKSPACE
    assert forwarded["user_id"] == USER
    assert forwarded["run_id"] == RUN
    assert "context" not in forwarded
    assert forwarded["resource_changes"][0]["type"] == "aws_instance"


@pytest.mark.parametrize("authorization", [
    None, "", "Basic test-service-token", "Bearer wrong-token", "Bearer ", b"Bearer \xc3\xa9",
])
def test_service_auth_rejects_before_membership_or_backend(authorization):
    membership = Membership()
    response, requests = call(run_body(), authorization=authorization, membership=membership)
    assert response.status_code == 401
    assert response.json() == {"detail": "Service authentication required"}
    assert membership.calls == 0
    assert requests == []


def test_no_rule_matched_returns_low_risk_without_approver():
    response, _ = call(run_body())
    body = response.json()
    assert body["requires_approval"] is False
    assert body["reason"] == "no approval rules matched"
    assert body["required_approver_role"] is None
    assert body["risk_level"] == "low"
    assert body["triggered_rules"] == []
    assert body["input_digest"] == DIGEST
    assert body["rule_set_version"] == "be-e01.v1"


@pytest.mark.parametrize(
    ("overrides", "triggered", "risk", "approver"),
    [
        (
            {"environment": "prod"},
            [rule("environment", "production environment", "admin", "high")],
            "high",
            "admin",
        ),
        (
            {"cost_estimate": {"estimated_monthly_usd": 900.0}},
            [rule("cost", "estimated monthly cost exceeds threshold", "finance", "medium")],
            "medium",
            "finance",
        ),
        (
            {"cost_estimate": {"estimated_monthly_usd": 2600, "source": "manifest_estimate"}},
            [rule("cost", "estimated monthly cost exceeds 5x threshold", "finance", "high")],
            "high",
            "finance",
        ),
        (
            {"resource_changes": [
                {"address": "aws_db_instance.main", "type": "aws_db_instance", "action": "delete"}
            ]},
            [rule("resource_type", "database delete", "admin", "critical")],
            "critical",
            "admin",
        ),
        (
            {"resource_changes": [{"type": "aws_iam_role", "action": "update"}]},
            [rule("resource_type", "IAM change", "security", "high")],
            "high",
            "security",
        ),
        (
            {"resource_changes": [{
                "type": "aws_security_group",
                "properties": {"ingress": [{"cidr_blocks": ["0.0.0.0/0"]}]},
            }]},
            [rule("resource_type", "inbound from the internet", "security", "high")],
            "high",
            "security",
        ),
        (
            {"public_exposure": True},
            [rule("public_exposure", "publicly exposed resources", "security", "high")],
            "high",
            "security",
        ),
        (
            {"policy": {"decision": "REQUIRES_APPROVAL", "violations": [{
                "rule_key": "budget", "severity": "approval", "description": "over budget",
                "evidence": "", "remediation_hint": "",
            }]}},
            [rule("policy_violation", "policy requires approval", "security", "medium")],
            "medium",
            "security",
        ),
        (
            {"resource_changes": [{"type": "aws_s3_bucket", "action": "replace"}]},
            [rule("role", "engineer replacing resources", "admin", "medium")],
            "medium",
            "admin",
        ),
        (
            {"environment": "production", "public_exposure": True},
            [
                rule("environment", "production environment", "admin", "high"),
                rule("public_exposure", "publicly exposed resources", "security", "high"),
            ],
            "critical",
            "admin",
        ),
    ],
    ids=[
        "environment",
        "cost-medium",
        "cost-high",
        "database-delete",
        "iam",
        "open-ingress",
        "public-exposure",
        "policy-violation",
        "role",
        "prod-escalation",
    ],
)
def test_rule_paths_return_backend_decision(overrides, triggered, risk, approver):
    response, requests = call(
        run_body(**overrides), evaluated(*triggered, risk=risk, approver=approver)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["requires_approval"] is True
    assert body["required_approver_role"] == approver
    assert body["risk_level"] == risk
    assert body["reason"] == "; ".join(r["reason"] for r in triggered)
    assert [r["rule"] for r in body["triggered_rules"]] == [r["rule"] for r in triggered]
    forwarded = json.loads(requests[0].content)
    for key, value in overrides.items():
        assert forwarded[key] == value


def test_identical_input_is_forwarded_identically():
    first, first_requests = call(run_body())
    second, second_requests = call(run_body())
    assert first_requests[0].content == second_requests[0].content
    assert first.json()["input_digest"] == second.json()["input_digest"]


def test_response_drops_unlisted_backend_fields():
    response, _ = call(run_body(), {**evaluated(), "debug": "DO_NOT_COPY"})
    assert response.status_code == 200
    assert "DO_NOT_COPY" not in response.text
    assert "config" not in response.json()


@pytest.mark.parametrize(
    "permissions", [["cloud:read"], ["approval:write"]], ids=["other", "write-only"]
)
def test_requires_approval_read_permission(permissions):
    response, requests = call(
        {**run_body(), "context": {**CONTEXT, "permissions": permissions}}
    )
    assert response.status_code == 403
    assert response.json()["error"] == "invalid_context"
    assert requests == []


def test_rejects_non_member_before_backend():
    response, requests = call(run_body(), member=False)
    assert response.status_code == 403
    assert requests == []


def test_rejects_missing_context():
    response, requests = call(RUN_CONTEXT)
    assert response.status_code == 403
    assert requests == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"workspace_id": str(uuid4())},
        {"user_id": str(uuid4())},
        {"user_role": "admin"},
        {"cost_estimate": {"estimated_monthly_usd": -1}},
        {"cost_estimate": {}},
        {"cost_estimate": {"estimated_monthly_usd": "100"}},
        {"policy": {"violations": []}},
        {"resource_changes": [{"type": ""}]},
        {"resource_changes": [{"type": "aws_instance", "extra": True}]},
        {"public_exposure": "yes"},
        {"run_id": "not-a-uuid"},
        {"environment": ""},
    ],
    ids=[
        "spoofed-workspace",
        "spoofed-user",
        "spoofed-role",
        "negative-cost",
        "missing-cost",
        "string-cost",
        "missing-decision",
        "empty-type",
        "unknown-change-field",
        "non-boolean-exposure",
        "bad-run-id",
        "empty-environment",
    ],
)
def test_rejects_invalid_run_context_before_backend(overrides):
    response, requests = call(run_body(**overrides))
    assert response.status_code == 422
    assert requests == []


def test_rejects_too_many_resource_changes():
    changes = [{"type": "aws_instance"}] * 1001
    response, requests = call(run_body(resource_changes=changes))
    assert response.status_code == 422
    assert requests == []


def test_missing_cost_estimate_object_is_rejected():
    body = run_body()
    del body["cost_estimate"]
    response, requests = call(body)
    assert response.status_code == 422
    assert requests == []


def test_unconfigured_service_token_returns_503():
    membership = Membership()
    response, requests = call(run_body(), token="", membership=membership)
    assert response.status_code == 503
    assert membership.calls == 0
    assert requests == []


def test_policy_deny_returns_409():
    response, _ = call(
        run_body(policy={"decision": "DENY", "violations": []}),
        {"error": "policy_denied", "message": "policy decision is DENY", "status": 409},
        status=409,
    )
    assert response.status_code == 409
    assert "DENY" in response.json()["detail"]


def test_backend_validation_error_returns_sanitized_422():
    response, _ = call(
        run_body(environment="qa"),
        {"error": "validation_error", "message": "environment: SECRET_DETAIL", "status": 400},
        status=400,
    )
    assert response.status_code == 422
    assert "SECRET_DETAIL" not in response.text


def test_backend_membership_miss_returns_invalid_context():
    response, _ = call(
        run_body(), {"error": "not_found", "message": "x", "status": 404}, status=404
    )
    assert response.status_code == 403
    assert response.json()["error"] == "invalid_context"


@pytest.mark.parametrize(
    ("backend_body", "status"),
    [
        ({"error": "internal_error", "message": "RAW_DB_ERROR", "status": 500}, 500),
        ({"error": "unauthorized", "message": "RAW", "status": 401}, 401),
        ({"error": "approval_rules_not_configured", "message": "RAW", "status": 503}, 503),
        (httpx.ConnectError("RAW_CONNECT_ERROR"), 200),
        (b"not json RAW", 200),
    ],
    ids=["server-error", "unauthorized", "backend-unconfigured", "connect-error", "malformed"],
)
def test_backend_failures_return_sanitized_502(backend_body, status):
    response, _ = call(run_body(), backend_body, status=status)
    assert response.status_code == 502
    assert "RAW" not in response.text


@pytest.mark.parametrize(
    "mutation",
    [
        lambda b: b.pop("evaluation_id"),
        lambda b: b.update(input_digest="not-a-digest"),
        lambda b: b.update(requires_approval=True),
        lambda b: b.update(risk_level="high"),
        lambda b: b.update(required_approver_role="admin"),
        lambda b: b.update(risk_level="extreme"),
        lambda b: b.update(requires_approval="false"),
    ],
    ids=[
        "unaudited",
        "bad-digest",
        "approval-without-rules",
        "elevated-risk-without-approval",
        "approver-without-approval",
        "unknown-risk",
        "string-boolean",
    ],
)
def test_contradictory_or_unaudited_decisions_are_rejected(mutation):
    backend_body = evaluated()
    mutation(backend_body)
    response, _ = call(run_body(), backend_body)
    assert response.status_code == 502


def test_rules_without_approver_are_rejected():
    backend_body = evaluated(
        rule("cost", "over threshold", "finance", "medium"), risk="medium", approver=None
    )
    response, _ = call(run_body(), backend_body)
    assert response.status_code == 502


def test_approver_not_backed_by_triggered_rule_is_rejected():
    backend_body = evaluated(
        rule("cost", "over threshold", "finance", "medium"), risk="medium", approver="admin"
    )
    response, _ = call(run_body(), backend_body)
    assert response.status_code == 502
