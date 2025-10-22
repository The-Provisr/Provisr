from __future__ import annotations

import json
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


class FakeMembershipStore:
    async def get_role(self, *, user_id: UUID, workspace_id: UUID) -> str | None:
        return "engineer"


def context_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "workspace_id": str(WORKSPACE_ID),
        "user_id": str(USER_ID),
        "permissions": ["cost:read"],
        "request_id": str(REQUEST_ID),
        "correlation_id": str(CORRELATION_ID),
        "session_id": str(SESSION_ID),
    }
    payload.update(overrides)
    return payload


def pricing_response(request: dict[str, Any], price: float, *, stale: bool = False) -> dict[str, Any]:
    return {
        "provider": request["provider"],
        "service": request["service"],
        "region": request["region"],
        "tier": request["tier"],
        "unit": request["unit"],
        "price_per_unit": price,
        "currency": request["currency"],
        "effective_date": "2026-10-27T00:00:00Z",
        "freshness_metadata": {
            "fetched_at": "2026-10-27T01:00:00Z",
            "expires_at": "2026-10-27T02:00:00Z",
            "stale": stale,
            "warning": "Using last cached provider price." if stale else None,
        },
    }


def make_client(handler: httpx.MockTransport) -> TestClient:
    http_client = httpx.AsyncClient(transport=handler)
    app = create_app(
        membership_store=FakeMembershipStore(),
        http_client=http_client,
        manifest_url="http://manifest.test",
        plan_url="http://plan.test",
        pricing_url="http://pricing.test",
    )
    return TestClient(app)


def test_estimate_cost_for_inline_manifest() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        payload = json.loads(request.content)
        price = 0.02 if payload["service"] == "AmazonEC2" else 0.023
        return httpx.Response(200, json=pricing_response(payload, price))

    body = {
        "context": context_payload(),
        "manifest": {
            "provider": "aws",
            "region": "us-east-1",
            "resources": [
                {
                    "logical_name": "web",
                    "type": "aws_ec2",
                    "provider_config": {"instance_type": "t3.micro", "count": 2},
                },
                {
                    "logical_name": "assets",
                    "type": "aws_s3",
                    "provider_config": {"storage_gb": 100},
                },
            ],
        },
    }

    with make_client(httpx.MockTransport(handler)) as client:
        response = client.post("/tools/estimate_cost", json=body)

    assert response.status_code == 200
    result = response.json()
    assert result["monthly_estimate"] == 31.5
    assert result["currency"] == "USD"
    assert len(result["resource_breakdown"]) == 2
    assert result["resource_breakdown"][0]["quantity"] == 1460
    assert result["resource_breakdown"][1]["quantity"] == 100
    assert result["confidence"] == 0.9
    assert result["freshness"]["stale"] is False
    assert "Assumed 730 running hours" in result["pricing_assumptions"][0]
    assert all(request.url == "http://pricing.test/v1/pricing/lookup" for request in captured)
    assert all(request.headers["X-Request-ID"] == str(REQUEST_ID) for request in captured)


def test_estimate_cost_resolves_manifest_reference_and_reports_stale_price() -> None:
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "content": {
                        "provider": "aws",
                        "region": "eu-west-1",
                        "resources": [
                            {
                                "logical_name": "database",
                                "type": "aws_rds",
                                "provider_config": {
                                    "instance_class": "db.t3.micro",
                                    "engine": "postgres",
                                    "hours_per_month": 100,
                                    "count": 1,
                                },
                            }
                        ],
                    }
                },
            )
        payload = json.loads(request.content)
        return httpx.Response(200, json=pricing_response(payload, 0.1, stale=True))

    with make_client(httpx.MockTransport(handler)) as client:
        response = client.post(
            "/tools/estimate_cost",
            json={
                "context": context_payload(),
                "manifest_reference": {"run_id": str(REQUEST_ID), "version": "latest"},
            },
        )

    assert response.status_code == 200
    result = response.json()
    assert result["monthly_estimate"] == 10
    assert result["source"] == "manifest"
    assert result["freshness"]["stale"] is True
    assert result["freshness"]["warnings"] == ["Using last cached provider price."]
    assert requested_paths == [
        f"/v1/runs/{REQUEST_ID}/manifests/latest",
        "/v1/pricing/lookup",
    ]


def test_estimate_cost_resolves_terraform_plan_reference() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "plan": {
                        "provider": "aws",
                        "region": "ap-southeast-1",
                        "resource_changes": [
                            {
                                "address": "aws_instance.web",
                                "type": "aws_instance",
                                "change": {"after": {"instance_type": "m5.large", "count": 1}},
                            }
                        ],
                    }
                },
            )
        payload = json.loads(request.content)
        assert payload["tier"] == "m5.large"
        return httpx.Response(200, json=pricing_response(payload, 0.2))

    plan_id = UUID("a1afd82e-a0ca-4bbf-9e8c-e3f12cfa25c4")
    with make_client(httpx.MockTransport(handler)) as client:
        response = client.post(
            "/tools/estimate_cost",
            json={
                "context": context_payload(),
                "plan_reference": {"run_id": str(REQUEST_ID), "plan_id": str(plan_id)},
            },
        )

    assert response.status_code == 200
    result = response.json()
    assert result["monthly_estimate"] == 146
    assert result["source"] == "plan"
    assert result["resource_breakdown"][0]["resource_id"] == "aws_instance.web"


def test_estimate_cost_rejects_reference_from_another_run() -> None:
    with make_client(httpx.MockTransport(lambda _: httpx.Response(500))) as client:
        response = client.post(
            "/tools/estimate_cost",
            json={
                "context": context_payload(),
                "manifest_reference": {
                    "run_id": "f7e009bb-d34f-4f8d-b7b8-d92f00bb3ce4",
                    "version": 1,
                },
            },
        )

    assert response.status_code == 403
    assert "current provisioning run" in response.json()["detail"]


def test_estimate_cost_requires_cost_permission_and_exactly_one_source() -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(500))
    with make_client(transport) as client:
        forbidden = client.post(
            "/tools/estimate_cost",
            json={
                "context": context_payload(permissions=["policy:read"]),
                "manifest": {"resources": []},
            },
        )
        invalid = client.post(
            "/tools/estimate_cost",
            json={
                "context": context_payload(),
                "manifest": {"resources": []},
                "plan": {"resource_changes": []},
            },
        )

    assert forbidden.status_code == 403
    assert invalid.status_code == 422


def test_estimate_cost_handles_pricing_service_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    with make_client(httpx.MockTransport(handler)) as client:
        response = client.post(
            "/tools/estimate_cost",
            json={
                "context": context_payload(),
                "manifest": {
                    "provider": "aws",
                    "region": "us-east-1",
                    "resources": [
                        {
                            "logical_name": "web",
                            "type": "aws_ec2",
                            "provider_config": {"instance_type": "t3.micro"},
                        }
                    ],
                },
            },
        )

    assert response.status_code == 502
    assert "Pricing lookup failed" in response.json()["detail"]
