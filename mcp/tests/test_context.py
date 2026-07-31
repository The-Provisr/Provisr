from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from src.context.errors import InvalidContextError
from src.context.fastapi import install_context_error_handler, require_context
from src.context.membership import PostgresMembershipStore
from src.context.models import MCPContext
from src.context.validator import validate_context
from src.servers.policy_server import create_app

WORKSPACE_ID = UUID("05a0cb9b-6793-4d47-ac80-c37916dc7b57")
USER_ID = UUID("fb352dce-57ea-47ad-a0d3-849d9888a313")
REQUEST_ID = UUID("e160fe9a-20b0-4a53-b7a4-af4acd899895")
CORRELATION_ID = UUID("0bc6e45b-4038-47d1-b392-eab5016356ef")
SESSION_ID = UUID("030aa973-4357-412f-98d1-7288a27f4bf7")


def context_payload(**overrides: object) -> dict[str, object]:
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


class FakeExecutor:
    def __init__(self, result: object) -> None:
        self.result = result
        self.query = ""
        self.args: tuple[Any, ...] = ()

    async def fetchval(self, query: str, *args: Any) -> object:
        self.query = query
        self.args = args
        return self.result


def test_accepts_complete_context_with_uuid_identifiers() -> None:
    context = MCPContext.model_validate(context_payload())

    assert context.workspace_id == WORKSPACE_ID
    assert context.user_id == USER_ID
    assert context.permissions == ("policy:read",)
    assert context.request_id == REQUEST_ID
    assert context.correlation_id == CORRELATION_ID
    assert context.session_id == SESSION_ID
    assert context.idempotency_key is None


@pytest.mark.parametrize(
    "field",
    [
        "workspace_id",
        "user_id",
        "permissions",
        "request_id",
        "correlation_id",
        "session_id",
    ],
)
def test_rejects_missing_required_context_field(field: str) -> None:
    payload = context_payload()
    del payload[field]

    with pytest.raises(ValidationError):
        MCPContext.model_validate(payload)


@pytest.mark.parametrize(
    "field",
    ["workspace_id", "user_id", "request_id", "correlation_id", "session_id"],
)
def test_rejects_invalid_uuid(field: str) -> None:
    with pytest.raises(ValidationError):
        MCPContext.model_validate(context_payload(**{field: "not-a-uuid"}))


def test_rejects_invalid_or_duplicate_permissions() -> None:
    with pytest.raises(ValidationError, match="resource:action"):
        MCPContext.model_validate(context_payload(permissions=["admin"]))

    with pytest.raises(ValidationError, match="unique"):
        MCPContext.model_validate(context_payload(permissions=["policy:read", "policy:read"]))


def test_rejects_extra_context_fields() -> None:
    with pytest.raises(ValidationError, match="Extra inputs"):
        MCPContext.model_validate(context_payload(untrusted_field="value"))


@pytest.mark.anyio
async def test_validate_context_accepts_workspace_member_with_permission() -> None:
    context = MCPContext.model_validate(context_payload())
    memberships = FakeMembershipStore()

    result = await validate_context(
        context,
        required_permission="policy:read",
        membership_store=memberships,
    )

    assert result is context
    assert memberships.calls == [(USER_ID, WORKSPACE_ID)]


@pytest.mark.anyio
async def test_validate_context_rejects_non_member() -> None:
    context = MCPContext.model_validate(context_payload())

    with pytest.raises(InvalidContextError, match="does not belong") as captured:
        await validate_context(
            context,
            required_permission="policy:read",
            membership_store=FakeMembershipStore(role=None),
        )

    assert captured.value.request_id == REQUEST_ID


@pytest.mark.anyio
async def test_validate_context_rejects_missing_permission() -> None:
    context = MCPContext.model_validate(context_payload(permissions=["workspace:read"]))

    with pytest.raises(InvalidContextError, match="policy:read") as captured:
        await validate_context(
            context,
            required_permission="policy:read",
            membership_store=FakeMembershipStore(),
        )

    assert captured.value.request_id == REQUEST_ID


@pytest.mark.anyio
async def test_validate_context_requires_idempotency_key_for_mutation() -> None:
    context = MCPContext.model_validate(context_payload(permissions=["provisioning_run:create"]))

    with pytest.raises(InvalidContextError, match="idempotency key"):
        await validate_context(
            context,
            required_permission="provisioning_run:create",
            membership_store=FakeMembershipStore(),
            require_idempotency_key=True,
        )

    valid_context = MCPContext.model_validate(
        context_payload(
            permissions=["provisioning_run:create"],
            idempotency_key=" create-run-123 ",
        )
    )
    result = await validate_context(
        valid_context,
        required_permission="provisioning_run:create",
        membership_store=FakeMembershipStore(),
        require_idempotency_key=True,
    )
    assert result.idempotency_key == "create-run-123"


@pytest.mark.anyio
async def test_postgres_membership_store_queries_active_workspace_membership() -> None:
    executor = FakeExecutor("engineer")
    store = PostgresMembershipStore(executor)

    role = await store.get_role(user_id=USER_ID, workspace_id=WORKSPACE_ID)

    assert role == "engineer"
    assert "provisr_identity.memberships" in executor.query
    assert "w.deleted_at IS NULL" in executor.query
    assert executor.args == (USER_ID, WORKSPACE_ID)


@dataclass(slots=True)
class FakeResources:
    membership_store: FakeMembershipStore


def build_protected_app(membership_store: FakeMembershipStore) -> FastAPI:
    application = FastAPI()
    application.state.resources = FakeResources(membership_store=membership_store)
    install_context_error_handler(application)

    @application.post("/tools/policy")
    async def policy_tool(
        context: Annotated[MCPContext, Depends(require_context("policy:read"))],
    ) -> dict[str, str]:
        return {
            "workspace_id": str(context.workspace_id),
            "request_id": str(context.request_id),
        }

    return application


def test_fastapi_dependency_accepts_valid_context() -> None:
    client = TestClient(build_protected_app(FakeMembershipStore()))

    response = client.post("/tools/policy", json={"context": context_payload()})

    assert response.status_code == 200
    assert response.json() == {
        "workspace_id": str(WORKSPACE_ID),
        "request_id": str(REQUEST_ID),
    }


def test_fastapi_dependency_returns_structured_error_for_missing_context() -> None:
    client = TestClient(build_protected_app(FakeMembershipStore()))

    response = client.post("/tools/policy", json={"resource": "policy"})

    assert response.status_code == 403
    assert response.json() == {
        "error": "invalid_context",
        "message": "Context envelope is missing or invalid",
        "request_id": None,
    }


def test_fastapi_dependency_returns_structured_error_for_malformed_uuid() -> None:
    client = TestClient(build_protected_app(FakeMembershipStore()))

    response = client.post(
        "/tools/policy",
        json={
            "context": context_payload(workspace_id="not-a-uuid"),
        },
    )

    assert response.status_code == 403
    assert response.json() == {
        "error": "invalid_context",
        "message": "Context envelope is missing or invalid",
        "request_id": str(REQUEST_ID),
    }


def test_fastapi_dependency_preserves_valid_request_id_on_authorization_failure() -> None:
    client = TestClient(build_protected_app(FakeMembershipStore()))

    response = client.post(
        "/tools/policy",
        json={
            "context": context_payload(permissions=["workspace:read"]),
        },
    )

    assert response.status_code == 403
    assert response.json() == {
        "error": "invalid_context",
        "message": "Context does not grant policy:read permission",
        "request_id": str(REQUEST_ID),
    }


def test_health_endpoints_do_not_require_context() -> None:
    with TestClient(create_app(FakeMembershipStore())) as client:
        live = client.get("/health/live")
        ready = client.get("/health/ready")

    assert live.status_code == 200
    assert ready.status_code == 200
