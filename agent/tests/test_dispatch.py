import json
from uuid import uuid4

import pytest

from app.api.schemas import AgentDispatchRequest
from app.domain.dispatch import ModelAgentDispatcher
from app.domain.errors import PhaseNotConfiguredError
from app.domain.service import AgentService
from app.integrations.checkpoints import InMemoryCheckpointStore
from app.integrations.mcp_tools import DeterministicReadOnlyToolClient
from app.integrations.state import InMemoryStateStore
from app.profiles.catalog import build_profile_selector
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel


def request(*, phase: str = "pending_agent") -> AgentDispatchRequest:
    return AgentDispatchRequest.model_validate(
        {
            "run_id": str(uuid4()),
            "session_id": str(uuid4()),
            "workspace_id": str(uuid4()),
            "user_id": str(uuid4()),
            "correlation_id": str(uuid4()),
            "phase": phase,
            "prompt": "Create a staging API in ap-southeast-1",
            "history": [{"role": "user", "content": "Use AWS"}],
        }
    )


def dispatcher(raw_output: str) -> tuple[ModelAgentDispatcher, FakeLanguageModel]:
    model = FakeLanguageModel(raw_output)
    profiles = build_profile_selector(build_prompt_registry())
    service = AgentService(
        state=InMemoryStateStore(), model=model, profile_selector=profiles
    )
    return ModelAgentDispatcher(
        service,
        DeterministicReadOnlyToolClient(),
        InMemoryCheckpointStore(),
    ), model


@pytest.mark.anyio
async def test_pending_agent_adapts_a_manifest_draft() -> None:
    dispatch_request = request()
    raw_output = json.dumps(
        {
            "type": "manifest_draft",
            "version": "1.0.0",
            "request_id": str(dispatch_request.correlation_id),
            "data": {
                "message": "Draft ready",
                "manifest": {
                    "provider": "aws",
                    "region": "ap-southeast-1",
                    "environment": "staging",
                    "resources": [
                        {
                            "type": "aws_ec2",
                            "name": "api",
                            "instance_type": "t3.small",
                            "image": "ubuntu-24.04",
                        }
                    ],
                },
            },
            "metadata": {"confidence": 1.0, "source": "llm_generated", "warnings": []},
        }
    )
    adapter, model = dispatcher(raw_output)

    response = await adapter.dispatch(dispatch_request)

    assert response.manifest_draft is not None
    assert response.tool_calls == []
    assert response.messages[0].content == "Draft ready"
    assert "Use AWS" in model.sessions[0].messages[-1].content
    assert "Create a staging API" in model.sessions[0].messages[-1].content


@pytest.mark.anyio
async def test_policy_phase_returns_read_only_evidence() -> None:
    adapter, model = dispatcher("{}")

    response = await adapter.dispatch(request(phase="pending_policy"))

    assert model.sessions == []
    assert response.tool_calls[0].tool_name == "get_policy_requirements"
    assert response.tool_calls[0].ok is True


@pytest.mark.anyio
async def test_unimplemented_phase_fails_closed() -> None:
    adapter, _ = dispatcher("{}")

    with pytest.raises(PhaseNotConfiguredError):
        await adapter.dispatch(request(phase="pending_iac"))
