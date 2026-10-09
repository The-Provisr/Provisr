import copy
import json

from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.main import create_app, create_resources
from app.outputs.runtime import render_runtime_system_prompt
from tests.fakes import FakeLanguageModel, FakePolicyRequirementsTool

WORKSPACE = "05a0cb9b-6793-4d47-ac80-c37916dc7b57"
REQUEST = "e160fe9a-20b0-4a53-b7a4-af4acd899895"
CONTEXT = {
    "workspace_id": WORKSPACE, "user_id": "fb352dce-57ea-47ad-a0d3-849d9888a313",
    "policy_context": {"enabled": True, "allowed_regions": ["us-east-1"], "max_budget": 500},
    "cloud_context": {"connected_providers": ["aws"], "active_accounts": [{
        "id": "0bc6e45b-4038-47d1-b392-eab5016356ef", "workspace_id": WORKSPACE,
        "provider": "aws", "label": "Test AWS", "status": "active",
        "verified_at": "2026-10-09T00:00:00Z", "supported_regions": ["us-east-1"],
        "resource_counts": None, "quota_limits": None,
    }]},
}


def test_bridge_context_is_pinned_and_reused_by_the_model() -> None:
    output = json.dumps({"type": "clarification_question", "version": "1.0.0", "request_id": REQUEST,
                         "data": {"question": "Which environment?"},
                         "metadata": {"confidence": 1, "source": "llm_generated", "warnings": []}})
    model = FakeLanguageModel(output)
    policy_tool = FakePolicyRequirementsTool()
    settings = Settings(environment="test", ORCHESTRATOR_SERVICE_TOKEN="test-only-token")
    resources = create_resources(settings, model=model, policy_tool=policy_tool)
    with TestClient(create_app(settings=settings, resources=resources)) as client:
        payload = {"organization_id": WORKSPACE, "request_id": REQUEST, "execution_context": CONTEXT}
        assert client.post("/v1/sessions", json=payload).status_code == 401
        headers = {"Authorization": "Bearer test-only-token"}
        created = client.post("/v1/sessions", json=payload, headers=headers)
        assert created.status_code == 201
        session_id = created.json()["session"]["session_id"]
        url = f"/v1/sessions/{session_id}/turns"
        assert client.post(url, json={"message": "Create a server"}).status_code == 401
        assert client.post(url, json={"message": "Create a server"}, headers=headers).status_code == 200
        assert client.post(url, json={"message": "Development"}, headers=headers).status_code == 200
    assert len(policy_tool.sessions) == 0
    assert len(model.sessions) == 2
    assert model.sessions[0].execution_context == model.sessions[1].execution_context
    session = model.sessions[0]
    prompt = render_runtime_system_prompt(model.profiles[0], session.request_id,
                                          session.policy_requirements, session.execution_context)
    assert "VALIDATED EXECUTION CONTEXT" in prompt
    assert "us-east-1" in prompt
    assert WORKSPACE in prompt


def test_bridge_rejects_foreign_accounts_and_credential_fields() -> None:
    model = FakeLanguageModel("unused")
    settings = Settings(environment="test", ORCHESTRATOR_SERVICE_TOKEN="test-only-token")
    resources = create_resources(settings, model=model)
    with TestClient(create_app(settings=settings, resources=resources)) as client:
        for change in [{"workspace_id": REQUEST}, {"secret_access_key": "DO_NOT_ACCEPT"}, {"status": "pending"}]:
            context = copy.deepcopy(CONTEXT)
            context["cloud_context"]["active_accounts"][0].update(change)
            response = client.post("/v1/sessions", json={"organization_id": WORKSPACE,
                "request_id": REQUEST, "execution_context": context},
                headers={"Authorization": "Bearer test-only-token"})
            assert response.status_code == 422
