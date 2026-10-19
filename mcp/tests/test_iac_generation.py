"""MCP-014's mounted HTTP boundary and the BE-D04 wire contract."""
import hashlib
import json
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from src.servers.policy_server import create_app

CONTEXT = {"workspace_id": str(uuid4()), "user_id": str(uuid4()), "request_id": str(uuid4()),
           "correlation_id": str(uuid4()), "session_id": str(uuid4()),
           "permissions": ["iac:write"], "idempotency_key": "iac-test-1"}
MANIFEST = str(uuid4())


class Membership:
    def __init__(self, member=True):
        self.member = member

    async def get_role(self, **kwargs):
        return "engineer" if self.member else None


def artifact():
    files = [{"path": path, "content": "# confirmed manifest ✓\n"} for path in
             ["main.tf", "outputs.tf", "resources/storage.tf", "terraform.tfvars", "variables.tf"]]
    digest = hashlib.sha256()
    for file in files:
        digest.update(f"{file['path']}\x00{file['content']}\x00".encode())
    return {"iac_artifact_id": str(uuid4()), "manifest_id": MANIFEST, "manifest_version": 1,
            "workspace_id": CONTEXT["workspace_id"], "run_id": CONTEXT["request_id"],
            "session_id": CONTEXT["session_id"], "terraform_files": files,
            "file_list": [file["path"] for file in files], "file_count": len(files),
            "total_size": sum(len(file["content"].encode()) for file in files),
            "hash": digest.hexdigest(), "template_source": "template",
            "summary": {"resource_count": 1, "file_count": len(files)}}


def call(body=None, *, result=None, status=200, member=True, token="test-only-token", raw=None):
    requests = []

    def respond(request):
        requests.append(request)
        if isinstance(result, Exception):
            raise result
        if raw is not None:
            return httpx.Response(status, content=raw)
        return httpx.Response(status, json=artifact() if result is None else result)

    runtime = create_app(membership_store=Membership(member),
                         http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
                         manifest_backend_url="http://manifest:8090", iac_service_token=token)
    with TestClient(runtime) as client:
        response = client.post("/tools/generate_iac", json=body if body is not None else
                               {"context": CONTEXT, "manifest_id": MANIFEST})
    return response, requests


def test_forwards_only_manifest_id_and_trusted_context():
    result = artifact()
    response, requests = call(result=result)
    assert response.status_code == 200
    assert response.json() == result
    assert len(requests) == 1
    assert str(requests[0].url) == "http://manifest:8090/v1/iac/generate"
    assert json.loads(requests[0].content) == {"context": CONTEXT, "manifest_id": MANIFEST}
    assert requests[0].headers["Authorization"] == "Bearer test-only-token"
    assert requests[0].headers["Idempotency-Key"] == CONTEXT["idempotency_key"]
    assert requests[0].headers["X-Correlation-ID"] == CONTEXT["correlation_id"]
    assert requests[0].extensions["timeout"]["read"] == 10.0


@pytest.mark.parametrize("change", [{"permissions": []}, {"idempotency_key": None},
                                    {"workspace_id": "bad"}, {"idempotency_key": " "}])
def test_invalid_context_never_calls_backend(change):
    response, requests = call({"context": {**CONTEXT, **change}, "manifest_id": MANIFEST})
    assert response.status_code == 403
    assert requests == []


def test_nonmember_and_missing_service_token_never_call_backend():
    response, requests = call(member=False)
    assert response.status_code == 403 and requests == []
    response, requests = call(token="")
    assert response.status_code == 502 and requests == []


@pytest.mark.parametrize("change", [{"manifest_id": "bad"}, {"manifest_id": str(uuid4()), "content": {}},
                                    {"manifest_id": "00000000-0000-0000-0000-000000000000"},
                                    {"manifest_id": MANIFEST, "confirmed": True}])
def test_input_cannot_inject_manifests_or_confirmation(change):
    response, requests = call({"context": CONTEXT, **change})
    assert response.status_code == 422 and requests == []


@pytest.mark.parametrize("change", [
    {"manifest_id": str(uuid4())}, {"workspace_id": str(uuid4())}, {"run_id": str(uuid4())},
    {"session_id": str(uuid4())}, {"manifest_version": 0}, {"file_count": True},
    {"total_size": 1}, {"hash": "0" * 64}, {"template_source": "ai-generated"},
    {"summary": {"resource_count": 1, "file_count": 900}},
    {"iac_artifact_id": "00000000-0000-0000-0000-000000000000"}, {"credentials": "DO_NOT_COPY"},
])
def test_malformed_or_foreign_artifacts_fail_closed(change):
    response, _ = call(result={**artifact(), **change})
    assert response.status_code == 502
    assert "DO_NOT_COPY" not in response.text


@pytest.mark.parametrize("path", ["../main.tf", "/main.tf", "resources/../main.tf", "a\\main.tf",
                                "main.tf\x00", "resources//main.tf", "terraform.tfstate"])
def test_unsafe_paths_rejected(path):
    result = artifact()
    result["terraform_files"][0]["path"] = path
    response, _ = call(result=result)
    assert response.status_code == 502


def test_duplicate_files_and_incomplete_module_rejected():
    for files in [artifact()["terraform_files"] * 2, artifact()["terraform_files"][1:]]:
        result = artifact()
        result["terraform_files"] = files
        response, _ = call(result=result)
        assert response.status_code == 502


@pytest.mark.parametrize("status", [401, 403, 404, 409, 422, 500])
def test_upstream_errors_never_echo_secrets(status):
    response, _ = call(status=status, result={"message": "DO_NOT_COPY", "error": "DO_NOT_COPY"})
    assert response.status_code == (502 if status in {401, 500} else status)
    assert "DO_NOT_COPY" not in response.text


def test_unsupported_resources_remain_structured_without_backend_details():
    result = {"error": "unsupported", "message": "DO_NOT_COPY", "unsupported": [
        {"logical_name": "queue", "type": "messaging.aws.sqs", "status": "unsupported"}]}
    response, _ = call(result=result, status=422)
    assert response.status_code == 422
    assert response.json()["detail"]["unsupported"] == result["unsupported"]
    assert "DO_NOT_COPY" not in response.text


@pytest.mark.parametrize("error", [httpx.ReadTimeout("DO_NOT_COPY"), httpx.ConnectError("DO_NOT_COPY")])
def test_network_failures_are_sanitized(error):
    response, _ = call(result=error)
    assert response.status_code == 502 and "DO_NOT_COPY" not in response.text


def test_invalid_json_and_oversized_response_rejected():
    for raw in [b"DO_NOT_COPY", b"x" * (8 * 1024 * 1024 + 1)]:
        response, _ = call(raw=raw)
        assert response.status_code == 502 and "DO_NOT_COPY" not in response.text


def test_standalone_iac_app_mounts_the_same_route():
    from src.servers.iac_server import app
    assert "/tools/generate_iac" in app.openapi()["paths"]
