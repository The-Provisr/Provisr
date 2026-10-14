from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient

from src.context.models import MCPContext
from src.servers.manifest_server import (
    ManifestValidationUnavailableError,
    create_app,
    validate_manifest,
)

WORKSPACE_ID = UUID("05a0cb9b-6793-4d47-ac80-c37916dc7b57")
USER_ID = UUID("fb352dce-57ea-47ad-a0d3-849d9888a313")
REQUEST_ID = UUID("e160fe9a-20b0-4a53-b7a4-af4acd899895")
CORRELATION_ID = UUID("0bc6e45b-4038-47d1-b392-eab5016356ef")
SESSION_ID = UUID("030aa973-4357-412f-98d1-7288a27f4bf7")

BACKEND_URL = "http://mock-backend:8090"
VALIDATE_URL = f"{BACKEND_URL}/v1/manifests/validate"

MANIFEST: dict[str, Any] = {
    "schema_version": "1.0",
    "provider": "aws",
    "region": "ap-southeast-1",
    "resources": [
        {"logical_name": "app-vpc", "type": "network.aws.vpc"},
        {
            "logical_name": "app-server",
            "type": "compute.aws.instance",
            "depends_on": ["app-vpc"],
        },
    ],
}

# Field, code and message values below are the ones emitted by
# backend/internal/manifest/validator.go.
MISSING_REGION = {
    "field": "region",
    "code": "missing_region",
    "message": "region is required",
}
INVALID_DOMAIN = {
    "field": "resources[0].type",
    "code": "invalid_domain",
    "message": 'resource domain "quantum" is not recognized',
}
DANGLING_DEPENDENCY = {
    "field": "resources[1].depends_on",
    "code": "dangling_dependency",
    "message": 'resource "app-server" depends on non-existent resource "app-db"',
}
PROVIDER_MISMATCH = {
    "field": "resources[0].type",
    "code": "provider_mismatch",
    "message": 'resource provider "gcp" in type does not match manifest provider "aws"',
}


def valid_context_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "workspace_id": str(WORKSPACE_ID),
        "user_id": str(USER_ID),
        "permissions": ["manifest:read"],
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


class FakeBackend:
    def __init__(self, respond: Callable[[httpx.Request], httpx.Response]) -> None:
        self.respond = respond
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.respond(request)


def backend_returning(status_code: int = 200, **kwargs: Any) -> FakeBackend:
    return FakeBackend(lambda _: httpx.Response(status_code, **kwargs))


def backend_raising(error: type[httpx.RequestError]) -> FakeBackend:
    def respond(request: httpx.Request) -> httpx.Response:
        raise error("boom", request=request)

    return FakeBackend(respond)


def call_tool(
    backend: FakeBackend,
    body: object,
    membership_store: FakeMembershipStore | None = None,
) -> httpx.Response:
    app = create_app(
        membership_store=membership_store or FakeMembershipStore(),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(backend)),
        backend_url=BACKEND_URL,
    )
    with TestClient(app) as client:
        return client.post("/tools/validate_manifest", json=body)


def tool_body(manifest: object = MANIFEST, **context_overrides: object) -> dict[str, object]:
    return {"context": valid_context_payload(**context_overrides), "manifest": manifest}


def test_validate_manifest_valid() -> None:
    # The backend omits errors (omitempty) when the manifest is valid.
    backend = backend_returning(json={"valid": True})

    response = call_tool(backend, tool_body())

    assert response.status_code == 200
    assert response.json() == {"valid": True, "errors": []}

    assert len(backend.requests) == 1
    req = backend.requests[0]
    assert req.method == "POST"
    assert req.url == VALIDATE_URL
    assert req.headers["X-Request-ID"] == str(REQUEST_ID)
    assert req.headers["X-Correlation-ID"] == str(CORRELATION_ID)
    assert json.loads(req.content) == MANIFEST


@pytest.mark.parametrize(
    "backend_error",
    [MISSING_REGION, INVALID_DOMAIN, DANGLING_DEPENDENCY, PROVIDER_MISMATCH],
    ids=lambda error: error["code"],
)
def test_validate_manifest_returns_field_level_error(backend_error: dict[str, str]) -> None:
    backend = backend_returning(json={"valid": False, "errors": [backend_error]})

    response = call_tool(backend, tool_body())

    assert response.status_code == 200
    assert response.json() == {
        "valid": False,
        "errors": [{**backend_error, "allowed_values": None}],
    }


def test_validate_manifest_returns_all_errors_in_order() -> None:
    backend_errors = [MISSING_REGION, PROVIDER_MISMATCH, INVALID_DOMAIN, DANGLING_DEPENDENCY]
    backend = backend_returning(json={"valid": False, "errors": backend_errors})

    response = call_tool(backend, tool_body())

    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert data["errors"] == [{**error, "allowed_values": None} for error in backend_errors]


def test_validate_manifest_passes_through_allowed_values() -> None:
    backend_error = {
        "field": "provider",
        "code": "invalid_provider",
        "message": 'unsupported provider "oracle"; must be one of: aws, azure, gcp',
        "allowed_values": ["aws", "azure", "gcp"],
    }
    backend = backend_returning(json={"valid": False, "errors": [backend_error]})

    response = call_tool(backend, tool_body())

    assert response.status_code == 200
    assert response.json() == {"valid": False, "errors": [backend_error]}


@pytest.mark.parametrize(
    "body",
    [
        {"manifest": MANIFEST},
        {"context": {"workspace_id": "not-a-uuid"}, "manifest": MANIFEST},
        tool_body(permissions=["policy:read"]),
        [MANIFEST],
    ],
    ids=["missing-context", "malformed-context", "under-privileged", "non-object-body"],
)
def test_validate_manifest_rejects_invalid_context_without_calling_backend(body: object) -> None:
    backend = backend_returning(json={"valid": True})

    response = call_tool(backend, body)

    assert response.status_code == 403
    assert response.json()["error"] == "invalid_context"
    assert backend.requests == []


def test_validate_manifest_rejects_non_member_without_calling_backend() -> None:
    backend = backend_returning(json={"valid": True})

    response = call_tool(backend, tool_body(), FakeMembershipStore(role=None))

    assert response.status_code == 403
    assert backend.requests == []


@pytest.mark.parametrize(
    "manifest",
    [None, [MANIFEST], json.dumps(MANIFEST), 42, True],
    ids=["null", "list", "string", "number", "boolean"],
)
def test_validate_manifest_rejects_non_object_manifest(manifest: object) -> None:
    backend = backend_returning(json={"valid": True})

    response = call_tool(backend, tool_body(manifest))

    assert response.status_code == 422
    assert response.json()["detail"] == "manifest is required and must be a JSON object"
    assert backend.requests == []


def test_validate_manifest_rejects_missing_manifest() -> None:
    backend = backend_returning(json={"valid": True})

    response = call_tool(backend, {"context": valid_context_payload()})

    assert response.status_code == 422
    assert backend.requests == []


@pytest.mark.parametrize(
    "backend",
    [
        backend_raising(httpx.ReadTimeout),
        backend_raising(httpx.ConnectTimeout),
        backend_raising(httpx.ConnectError),
        backend_returning(500, text="internal error"),
        backend_returning(404, text="404 page not found"),
        backend_returning(400, json={"valid": True}),
        backend_returning(text="not json"),
        backend_returning(json=[{"valid": True}]),
        backend_returning(json={}),
        backend_returning(json={"valid": "true"}),
        backend_returning(json={"errors": []}),
        backend_returning(json={"valid": False, "errors": "region is required"}),
        backend_returning(json={"valid": False, "errors": [{"field": "region"}]}),
        backend_returning(json={"valid": False, "errors": ["region is required"]}),
        backend_returning(json={"valid": True, "errors": [MISSING_REGION]}),
        backend_returning(json={"valid": False}),
        backend_returning(json={"valid": False, "errors": []}),
        backend_returning(
            json={
                "valid": False,
                "errors": [
                    {"field": 42, "code": "invalid", "message": "invalid"},
                ],
            }
        ),
    ],
    ids=[
        "read-timeout",
        "connect-timeout",
        "connection-error",
        "server-error",
        "not-found",
        "client-error-with-valid-body",
        "non-json-body",
        "non-object-body",
        "empty-object",
        "non-boolean-valid",
        "missing-valid",
        "errors-not-a-list",
        "error-missing-fields",
        "error-not-an-object",
        "valid-with-errors",
        "invalid-without-errors-key",
        "invalid-with-empty-errors",
        "coerced-error-field",
    ],
)
def test_validate_manifest_backend_failure_is_a_tool_error(backend: FakeBackend) -> None:
    response = call_tool(backend, tool_body())

    assert response.status_code == 502
    data = response.json()
    assert "Manifest validation could not be performed" in data["detail"]
    assert "valid" not in data
    assert len(backend.requests) == 1


def test_validate_manifest_logs_outcome_without_manifest_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    backend = backend_returning(
        json={"valid": False, "errors": [MISSING_REGION, DANGLING_DEPENDENCY]}
    )

    with caplog.at_level(logging.INFO, logger="src.servers.manifest_server"):
        call_tool(backend, tool_body())

    assert "outcome=invalid" in caplog.text
    assert "error_count=2" in caplog.text
    assert str(CORRELATION_ID) in caplog.text
    assert "app-vpc" not in caplog.text
    assert "ap-southeast-1" not in caplog.text


def test_validate_manifest_logs_failure_with_correlation_id(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger="src.servers.manifest_server"):
        call_tool(backend_returning(500, text="app-vpc exploded"), tool_body())

    assert "outcome=unavailable" in caplog.text
    assert str(CORRELATION_ID) in caplog.text
    assert "app-vpc" not in caplog.text


@pytest.mark.anyio
async def test_validate_manifest_function_is_reusable_without_the_tool_wrapper() -> None:
    context = MCPContext.model_validate(valid_context_payload())
    backend = backend_returning(json={"valid": False, "errors": [MISSING_REGION]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(backend)) as client:
        result = await validate_manifest(
            MANIFEST,
            context,
            http_client=client,
            backend_url=BACKEND_URL,
        )

    assert result.valid is False
    assert [error.code for error in result.errors] == ["missing_region"]
    assert backend.requests[0].url == VALIDATE_URL


@pytest.mark.anyio
async def test_validate_manifest_function_raises_when_backend_unavailable() -> None:
    context = MCPContext.model_validate(valid_context_payload())
    backend = backend_raising(httpx.ConnectError)

    async with httpx.AsyncClient(transport=httpx.MockTransport(backend)) as client:
        with pytest.raises(ManifestValidationUnavailableError):
            await validate_manifest(
                MANIFEST,
                context,
                http_client=client,
                backend_url=BACKEND_URL,
            )


def test_runtime_serves_one_manifest_route_and_projects_drafts() -> None:
    from test_manifest_validation import CLOUD, POLICY
    from test_manifest_validation import MANIFEST as DRAFT

    from src.servers.policy_server import create_app as create_runtime

    backend = backend_returning(json={"valid": True, "errors": []})
    runtime = create_runtime(
        membership_store=FakeMembershipStore(),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(backend)),
        backend_url="http://policy:8081",
        manifest_backend_url=BACKEND_URL,
    )
    operation = runtime.openapi()["paths"]["/tools/validate_manifest"]["post"]
    assert operation["operationId"].startswith("validate_manifest_tool_")
    body = {
        "context": valid_context_payload(permissions=["manifest:read", "manifest:write"]),
        "manifest": DRAFT,
        "cloud_context": CLOUD,
        "policy_context": POLICY,
    }
    with TestClient(runtime) as client:
        result = client.post("/tools/validate_manifest", json=body)
    assert result.status_code == 200
    assert result.json() == {"valid": True, "errors": []}
    request = backend.requests[0]
    assert request.url == VALIDATE_URL
    submitted = json.loads(request.content)
    assert submitted["resources"][0]["logical_name"] == "resource_0"
    assert submitted["resources"][0]["properties"]["name"] == DRAFT["resources"][0]["name"]
    assert submitted["resources"][0]["type"] == "storage.aws.s3"
    assert submitted["resources"][0]["security_settings"] == DRAFT["security"]
    assert submitted["resources"][0]["properties"]["versioning"] is True
    assert "logical_name" not in DRAFT["resources"][0]


@pytest.mark.parametrize(
    ("resource", "canonical_type"),
    [
        (
            {
                "type": "aws_ec2",
                "name": "AppServer",
                "image": "ami-test",
                "instance_type": "t3.micro",
            },
            "compute.aws.instance",
        ),
        (
            {
                "type": "aws_rds",
                "name": "AppDB",
                "engine": "mysql",
                "instance_class": "db.t3.micro",
                "allocated_storage_gb": 20,
            },
            "database.aws.rds",
        ),
        ({"type": "aws_s3", "name": "app.data.bucket"}, "storage.aws.s3"),
    ],
)
def test_projection_preserves_cloud_names_and_provider_configuration(
    resource: dict[str, object],
    canonical_type: str,
) -> None:
    from test_manifest_validation import CLOUD, POLICY
    from test_manifest_validation import MANIFEST as DRAFT

    backend = backend_returning(json={"valid": True})
    response = call_tool(
        backend,
        {
            "context": valid_context_payload(),
            "manifest": {**DRAFT, "resources": [resource]},
            "cloud_context": CLOUD,
            "policy_context": POLICY,
        },
    )
    assert response.status_code == 200
    assert response.json()["valid"] is True
    projected = json.loads(backend.requests[0].content)["resources"][0]
    assert projected["logical_name"] == "resource_0"
    assert projected["type"] == canonical_type
    assert projected["properties"] == {k: v for k, v in resource.items() if k != "type"}


@pytest.mark.parametrize(
    "overrides",
    [
        {"cloud_context": None},
        {"policy_context": None},
        {"policy_context": {"enabled": True, "allowed_regions": ["eu-west-1"]}},
        {"manifest": {"provider": "aws"}},
    ],
)
def test_runtime_draft_guards_cannot_be_bypassed(overrides: dict[str, object]) -> None:
    from test_manifest_validation import CLOUD, POLICY
    from test_manifest_validation import MANIFEST as DRAFT

    from src.servers.policy_server import create_app as create_runtime

    backend = backend_returning(json={"valid": True, "errors": []})
    runtime = create_runtime(
        membership_store=FakeMembershipStore(),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(backend)),
        manifest_backend_url=BACKEND_URL,
    )
    body = {
        "context": valid_context_payload(),
        "manifest": DRAFT,
        "cloud_context": CLOUD,
        "policy_context": POLICY,
        **overrides,
    }
    with TestClient(runtime) as client:
        result = client.post("/tools/validate_manifest", json=body)
    assert result.status_code == 200
    assert result.json()["valid"] is False
    assert result.json()["errors"][0]["code"] == "invalid_draft"
    assert backend.requests == []


def test_manifest_service_env_is_independent_of_policy_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MANIFEST_SERVICE_URL", BACKEND_URL + "/")
    monkeypatch.setenv("POLICY_SERVICE_URL", "http://policy:8081")
    monkeypatch.setenv("BACKEND_URL", "http://provisioning:8083")
    backend = backend_returning(json={"valid": True})
    runtime = create_app(
        membership_store=FakeMembershipStore(),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(backend)),
    )
    with TestClient(runtime) as client:
        assert client.post("/tools/validate_manifest", json=tool_body()).status_code == 200
    assert backend.requests[0].url == VALIDATE_URL


def test_backend_error_codes_are_not_logged(caplog: pytest.LogCaptureFixture) -> None:
    backend = backend_returning(
        json={
            "valid": False,
            "errors": [
                {"field": "region", "code": "SECRET_FROM_BACKEND", "message": "secret"},
            ],
        }
    )
    with caplog.at_level(logging.INFO, logger="src.servers.manifest_server"):
        call_tool(backend, tool_body())
    assert "outcome=invalid" in caplog.text
    assert "SECRET_FROM_BACKEND" not in caplog.text
