"""MCP-015's authenticated, bounded BE-D05 planning adapter contract."""
import asyncio
import json
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from src.servers.policy_server import create_app

CONTEXT = {
    "workspace_id": str(uuid4()), "user_id": str(uuid4()), "request_id": str(uuid4()),
    "correlation_id": str(uuid4()), "session_id": str(uuid4()),
    "permissions": ["iac:write"], "idempotency_key": "plan-test-1",
}
ARTIFACT = str(uuid4())


class Membership:
    def __init__(self, member=True):
        self.member = member
        self.calls = 0

    async def get_role(self, **kwargs):
        self.calls += 1
        return "engineer" if self.member else None


def plan():
    plan_id = str(uuid4())
    return {
        "plan_artifact_id": plan_id, "iac_artifact_id": ARTIFACT, "manifest_id": str(uuid4()),
        "manifest_version": 2, "run_id": CONTEXT["request_id"],
        "workspace_id": CONTEXT["workspace_id"], "session_id": CONTEXT["session_id"],
        "hash": "a" * 64, "raw_plan_json_reference": f"db://provisr_iac/plans/{plan_id}/json",
        "summary": {
            "create_count": 1, "update_count": 0, "delete_count": 0, "unchanged_count": 0,
            "resource_changes": [{"address": "aws_instance.web", "resource_type": "aws_instance",
                                  "change_type": "create", "risk_tags": ["cost_impact"]}],
        },
    }


def call(body=None, *, result=None, status=200, raw=None, stream=None, handler=None,
         member=True, membership=None, token="test-only-token", authorization="Bearer test-only-token"):
    requests = []

    async def respond(request):
        requests.append(request)
        if handler is not None:
            return await handler(request)
        if isinstance(result, Exception):
            raise result
        if stream is not None:
            return httpx.Response(status, stream=stream)
        if raw is not None:
            return httpx.Response(status, content=raw)
        return httpx.Response(status, json=plan() if result is None else result)

    runtime = create_app(
        membership_store=membership if membership is not None else Membership(member),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        provisioning_backend_url="http://provisioning:8083", iac_service_token=token,
    )
    with TestClient(runtime) as client:
        response = client.post(
            "/tools/create_plan", json={"context": CONTEXT, "iac_artifact_id": ARTIFACT} if body is None else body,
            headers={} if authorization is None else {"Authorization": authorization},
        )
    return response, requests


def test_forwards_only_persisted_artifact_and_scoped_context():
    result = plan()
    response, requests = call(result=result)
    assert response.status_code == 200
    assert response.json() == result
    assert len(requests) == 1
    sent = requests[0]
    assert str(sent.url) == "http://provisioning:8083/v1/iac/plans"
    assert json.loads(sent.content) == {"context": CONTEXT, "iac_artifact_id": ARTIFACT}
    assert sent.headers["Authorization"] == "Bearer test-only-token"
    assert sent.headers["Idempotency-Key"] == CONTEXT["idempotency_key"]
    assert sent.headers["X-Request-ID"] == CONTEXT["request_id"]
    assert sent.headers["X-Correlation-ID"] == CONTEXT["correlation_id"]
    assert sent.extensions["timeout"]["read"] == 110.0


@pytest.mark.parametrize("authorization", [None, "", "Basic test-only-token", "Bearer wrong", b"Bearer \xc3\xa9"])
def test_rejects_unauthenticated_callers_before_membership_or_backend(authorization):
    membership = Membership()
    response, requests = call(authorization=authorization, membership=membership)
    assert response.status_code == 401
    assert membership.calls == 0 and requests == []
    assert response.json() == {"detail": "Service authentication required"}


def test_unconfigured_service_fails_before_membership():
    membership = Membership()
    response, requests = call(token="", membership=membership)
    assert response.status_code == 502
    assert membership.calls == 0 and requests == []


@pytest.mark.parametrize("changes", [
    {"permissions": []}, {"permissions": ["iac:read"]}, {"idempotency_key": None},
    {"idempotency_key": " "}, {"workspace_id": "bad"},
])
def test_requires_valid_scoped_mutation_context(changes):
    response, requests = call({"context": {**CONTEXT, **changes}, "iac_artifact_id": ARTIFACT})
    assert response.status_code == 403 and requests == []


def test_requires_live_workspace_membership():
    response, requests = call(member=False)
    assert response.status_code == 403 and requests == []


@pytest.mark.parametrize("changes", [
    {"iac_artifact_id": "bad"}, {"iac_artifact_id": str(uuid4()), "terraform_files": []},
    {"iac_artifact_id": ARTIFACT, "commands": ["apply"]},
    {"iac_artifact_id": ARTIFACT, "credentials": "DO_NOT_COPY"},
    {"iac_artifact_id": "00000000-0000-0000-0000-000000000000"},
])
def test_cannot_inject_files_commands_or_credentials(changes):
    response, requests = call({"context": CONTEXT, **changes})
    assert response.status_code == 422 and requests == []
    assert "DO_NOT_COPY" not in response.text


@pytest.mark.parametrize("field", ["iac_artifact_id", "run_id", "workspace_id", "session_id"])
def test_rejects_foreign_plan_provenance(field):
    response, _ = call(result={**plan(), field: str(uuid4())})
    assert response.status_code == 502


@pytest.mark.parametrize("field", [
    "plan_artifact_id", "iac_artifact_id", "manifest_id", "run_id", "workspace_id", "session_id",
])
def test_rejects_empty_identifiers(field):
    response, _ = call(result={**plan(), field: "00000000-0000-0000-0000-000000000000"})
    assert response.status_code == 502


@pytest.mark.parametrize("reference", [
    "file:///tmp/SECRET", "https://example.test/SECRET", f"db://provisr_iac/plans/{uuid4()}/json",
    "db://provisr_iac/plans/../json", "DO_NOT_COPY",
])
def test_rejects_noncanonical_or_foreign_raw_plan_reference(reference):
    response, _ = call(result={**plan(), "raw_plan_json_reference": reference})
    assert response.status_code == 502 and "DO_NOT_COPY" not in response.text


@pytest.mark.parametrize("changes", [
    {"hash": "A" * 64}, {"hash": "bad"}, {"manifest_version": 0}, {"manifest_version": True},
    {"raw_plan_json": {"password": "DO_NOT_COPY"}}, {"credentials": "DO_NOT_COPY"},
])
def test_rejects_malformed_metadata_and_unlisted_raw_payload(changes):
    response, _ = call(result={**plan(), **changes})
    assert response.status_code == 502 and "DO_NOT_COPY" not in response.text


@pytest.mark.parametrize("field,value", [
    ("create_count", -1), ("update_count", True), ("delete_count", 10001),
    ("unchanged_count", "0"), ("create_count", 2), ("update_count", 1),
])
def test_rejects_invalid_or_inconsistent_summary_counts(field, value):
    result = plan()
    result["summary"][field] = value
    response, _ = call(result=result)
    assert response.status_code == 502


def test_replacement_and_data_source_counts_follow_managed_resource_semantics():
    result = plan()
    result["summary"] = {
        "create_count": 1, "update_count": 0, "delete_count": 1, "unchanged_count": 0,
        "resource_changes": [
            {"address": "module.web.aws_instance.main[0]", "resource_type": "aws_instance", "change_type": "replace", "risk_tags": ["destructive", "cost_impact"]},
            {"address": "module.web.data.aws_ami.latest", "resource_type": "aws_ami", "change_type": "read", "risk_tags": []},
            {"address": 'module.web["prod/network"].data.aws_ami.same', "resource_type": "aws_ami", "change_type": "no-op", "risk_tags": []},
        ],
    }
    response, _ = call(result=result)
    assert response.status_code == 200
    assert response.json()["summary"] == result["summary"]


@pytest.mark.parametrize("change", [
    {"address": "aws_instance.web\nDO_NOT_COPY"}, {"address": "aws_instance.web; apply"},
    {"address": "DO_NOT_COPY"}, {"resource_type": "bad DO_NOT_COPY"},
    {"resource_type": "aws_instance;apply"}, {"address": "a" * 1025},
    {"change_type": "apply"}, {"risk_tags": ["DO_NOT_COPY"]},
    {"risk_tags": ["destructive", "destructive"]}, {"credentials": "DO_NOT_COPY"},
])
def test_rejects_unsafe_resource_metadata(change):
    result = plan()
    result["summary"]["resource_changes"][0].update(change)
    response, _ = call(result=result)
    assert response.status_code == 502 and "DO_NOT_COPY" not in response.text


def test_rejects_duplicate_or_oversized_resource_lists():
    for count in [2, 1001]:
        result = plan()
        result["summary"]["resource_changes"] *= count
        response, _ = call(result=result)
        assert response.status_code == 502


@pytest.mark.parametrize("status", [400, 401, 403, 404, 409, 422, 500, 503, 504])
def test_upstream_errors_use_fixed_safe_messages(status):
    response, _ = call(status=status, result={"error": "DO_NOT_COPY", "message": "DO_NOT_COPY"})
    assert response.status_code == (status if status in {403, 404, 409, 422} else 502)
    assert "DO_NOT_COPY" not in response.text


@pytest.mark.parametrize("failure", [httpx.ReadTimeout("DO_NOT_COPY"), httpx.ConnectError("DO_NOT_COPY")])
def test_network_failures_are_sanitized(failure):
    response, _ = call(result=failure)
    assert response.status_code == 502 and "DO_NOT_COPY" not in response.text


@pytest.mark.parametrize("raw", [b"DO_NOT_COPY", b"x" * (2 * 1024 * 1024 + 1)])
def test_invalid_or_oversized_body_fails_closed(raw):
    response, _ = call(raw=raw)
    assert response.status_code == 502 and "DO_NOT_COPY" not in response.text


def test_total_deadline_aborts_slow_stream_and_closes_body(monkeypatch):
    from src.servers import iac_planning

    class SlowStream(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            content = json.dumps(plan()).encode()
            for offset in range(0, len(content), 8):
                yield content[offset:offset + 8]
                await asyncio.sleep(0.003)

        async def aclose(self):
            self.closed = True

    monkeypatch.setattr(iac_planning, "IAC_PLANNING_TIMEOUT_SECONDS", 0.01)
    stream = SlowStream()
    response, _ = call(stream=stream)
    assert response.status_code == 504
    assert stream.closed
    assert response.json() == {"detail": "Terraform planning timed out; retry with the same key"}


def test_total_deadline_includes_waiting_for_response_headers(monkeypatch):
    from src.servers import iac_planning

    async def delayed_headers(request):
        await asyncio.sleep(0.05)
        return httpx.Response(200, json=plan())

    monkeypatch.setattr(iac_planning, "IAC_PLANNING_TIMEOUT_SECONDS", 0.01)
    response, _ = call(handler=delayed_headers)
    assert response.status_code == 504


def test_empty_plan_counts_are_valid():
    result = deepcopy(plan())
    result["summary"] = {"create_count": 0, "update_count": 0, "delete_count": 0, "unchanged_count": 0, "resource_changes": []}
    response, _ = call(result=result)
    assert response.status_code == 200


def test_standalone_iac_server_mounts_plan_tool():
    from src.servers.iac_server import app
    assert "/tools/create_plan" in app.openapi()["paths"]
