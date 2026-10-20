"""AG-M02: API-level self-test for the agent envelope chain.

The test uses a deterministic bridge/model fixture so CI exercises the complete
session -> policy -> clarification -> answered turn -> manifest path without
cloud credentials or an LLM account. Policy requirements go through the same
validated tool contract used by the live MCP adapter.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.main import Resources, create_app
from app.policy.mcp import MCPPolicyRequirementsTool
from app.integrations.state import InMemoryStateStore
from app.profiles.catalog import build_profile_selector
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel


REQUEST_ID = UUID("497c1c82-b4b4-4ae3-ad13-fccbcbf8cda1")
WORKSPACE_ID = UUID("05a0cb9b-6793-4d47-ac80-c37916dc7b57")
POLICY = {
    "enabled": True,
    "allowed_regions": ["us-east-1"],
    "required_encryption": True,
    "required_backup": True,
    "required_tags": {"owner": "platform"},
}


class StubBridgeCaller:
    """CI bridge double exercised through the production MCP policy adapter."""

    def __init__(self) -> None:
        self.calls = 0

    async def call_tool(self, tool_name, arguments, session):  # type: ignore[no-untyped-def]
        assert tool_name == "get_policy_requirements"
        assert arguments == {}
        self.calls += 1
        return POLICY


def _model_envelope(kind: str, data: dict[str, object]) -> str:
    return json.dumps({
        "type": kind,
        "version": "1.0.0",
        "request_id": str(REQUEST_ID),
        "data": data,
        "metadata": {"confidence": 0.96, "source": "llm_generated", "warnings": []},
    })


def _build_client() -> tuple[TestClient, StubBridgeCaller]:
    clarification = _model_envelope("clarification_question", {
        "question": "Which workload name should I use?",
        "fields": [{"name": "workload_name", "type": "string"}],
        "question_id": "workload-name",
        "input_type": "text",
        "field_mapping": "resources[0].name",
    })
    draft = _model_envelope("manifest_draft", {
        "message": "Drafted a policy-aware workload.",
        "manifest": {
            "provider": "aws", "region": "us-east-1", "environment": "development",
            "security": {"encryption_enabled": True}, "backup": {"enabled": True},
            "policy": {"requirements_loaded": True, "applied_constraints": []},
            "tags": {"owner": "platform"},
            "resources": [{"type": "aws_ec2", "name": "api-server",
                           "instance_type": "t3.micro", "image": "ubuntu-24.04"}],
        },
    })

    class SequenceModel(FakeLanguageModel):
        def __init__(self) -> None:
            super().__init__(clarification)
            self.outputs = [clarification, draft]

        async def complete_turn(self, session, profile):  # type: ignore[no-untyped-def]
            self.sessions.append(session.model_copy(deep=True))
            self.profiles.append(profile)
            return self.outputs.pop(0)

    state = InMemoryStateStore()
    bridge = StubBridgeCaller()
    policy = MCPPolicyRequirementsTool(bridge)
    registry = build_prompt_registry()
    profile_selector = build_profile_selector(registry)
    model = SequenceModel()
    from app.domain.service import AgentService

    resources = Resources(
        state=state,
        prompt_registry=registry,
        profile_selector=profile_selector,
        policy_tool=policy,
        agent_service=AgentService(
            state=state, model=model, profile_selector=profile_selector, policy_tool=policy,
        ),
    )
    return (
        TestClient(
            create_app(
                settings=Settings(
                    environment="test",
                    orchestrator_service_token="self-test-token",
                ),
                resources=resources,
            )
        ),
        bridge,
    )


def test_agent_integration_self_test_runs_bridge_envelope_chain() -> None:
    client, policy = _build_client()
    headers = {"Authorization": "Bearer self-test-token"}
    created = client.post("/v1/sessions", headers=headers, json={
        "organization_id": str(WORKSPACE_ID), "request_id": str(REQUEST_ID),
    })
    assert created.status_code == 201, created.text
    session_id = created.json()["session"]["session_id"]

    first = client.post(
        f"/v1/sessions/{session_id}/turns",
        headers=headers,
        json={"message": "Create an AWS web server in us-east-1 for development"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["result"]["type"] == "clarification_question"

    second = client.post(
        f"/v1/sessions/{session_id}/turns",
        headers=headers,
        json={
            "message": "Use api-server",
            "answers": [
                {
                    "question_id": first.json()["result"]["data"]["question_id"],
                    "field_mapping": "resources[0].name",
                    "answer": "api-server",
                }
            ],
        },
    )
    assert second.status_code == 200, second.text
    result = second.json()["result"]
    assert result["type"] == "manifest_draft"
    assert result["metadata"]["source"] == "llm_generated"
    assert result["metadata"]["confidence"] >= 0.9
    assert policy.calls == 1
    assert result["data"]["manifest"]["region"] == "us-east-1"
    assert result["data"]["manifest"]["security"]["encryption_enabled"]
    assert result["data"]["manifest"]["backup"]["enabled"]
    assert result["data"]["manifest"]["tags"]["owner"] == "platform"

    events = client.get(f"/v1/sessions/{session_id}/events", headers=headers)
    assert events.status_code == 200
    assert "event: policy.requirements.loaded" in events.text
    assert "event: manifest.draft" in events.text
    assert "source_metadata" in events.text


def test_shared_contracts_typecheck_available_for_ci() -> None:
    """Keep the shared-contract package in the executable self-test path."""
    repo = Path(__file__).resolve().parents[2]
    package = repo / "packages" / "shared-contracts"
    if not (package / "node_modules").is_dir():
        pytest.skip("shared-contracts dependencies are not installed")
    result = subprocess.run(
        ["npm", "run", "typecheck"],
        cwd=package,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
