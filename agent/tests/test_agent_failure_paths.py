import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.domain.errors import DependencyUnavailableError, InvalidModelResponseError
from app.domain.service import AgentService
from app.integrations.anthropic_model import ClaudeModel
from app.integrations.state import InMemoryStateStore
from app.main import Resources, create_app
from app.profiles.catalog import build_profile_selector
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel, FakePolicyRequirementsTool
from tests.test_anthropic_model import provisioning_profile, session

REQUEST_ID = "8b8c64dc-6607-4a45-aa71-f51b2d381cdf"
API_KEY = "sk-ant-test-secret-key"


def build_app(model: FakeLanguageModel) -> tuple[TestClient, InMemoryStateStore]:
    state = InMemoryStateStore()
    prompt_registry = build_prompt_registry()
    profile_selector = build_profile_selector(prompt_registry)
    policy_tool = FakePolicyRequirementsTool()
    resources = Resources(
        state=state,
        prompt_registry=prompt_registry,
        profile_selector=profile_selector,
        policy_tool=policy_tool,
        agent_service=AgentService(
            state=state,
            model=model,
            profile_selector=profile_selector,
            policy_tool=policy_tool,
        ),
    )
    app = create_app(settings=Settings(environment="test"), resources=resources)
    return TestClient(app), state


def start_session(client: TestClient) -> str:
    created = client.post(
        "/v1/sessions",
        json={"organization_id": "org-1", "request_id": REQUEST_ID},
    )
    assert created.status_code == 201
    return created.json()["session"]["session_id"]


class RaisingMessages:
    def __init__(self, error: Exception) -> None:
        self._error = error
        self.calls = 0

    def create(self, **_: object) -> object:
        self.calls += 1
        raise self._error


class EmptyMessages:
    def create(self, **_: object) -> object:
        return SimpleNamespace(content=[SimpleNamespace(type="text", text="   ")])


def claude_with(messages: object) -> ClaudeModel:
    return ClaudeModel(
        api_key=API_KEY,
        model="claude-sonnet-4-5",
        client=SimpleNamespace(messages=messages),
    )


# Invalid LLM output


@pytest.mark.parametrize(
    "raw_output",
    [
        "not json at all",
        "",
        "[]",
        json.dumps({"type": "unknown_type", "version": "1.0.0", "request_id": REQUEST_ID}),
    ],
)
def test_malformed_model_output_fails_turn_and_is_recorded(raw_output: str) -> None:
    client, _ = build_app(FakeLanguageModel(raw_output))
    with client:
        session_id = start_session(client)
        response = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Create a server"},
        )
        events = client.get(f"/v1/sessions/{session_id}/events")

    assert response.status_code == 502
    assert response.json()["code"] == "INVALID_MODEL_RESPONSE"
    assert "event: turn.failed" in events.text
    assert "event: stream.completed" not in events.text


def test_failed_turn_blocks_untracked_retries() -> None:
    model = FakeLanguageModel("not json")
    client, state = build_app(model)
    with client:
        session_id = start_session(client)
        client.post(f"/v1/sessions/{session_id}/turns", json={"message": "Create a server"})
        retry = client.post(f"/v1/sessions/{session_id}/turns", json={"message": "Again"})
        stored = client.portal.call(state.get_session, session_id)

    assert retry.status_code == 409
    assert retry.json()["code"] == "SESSION_FAILED"
    assert stored.status == "FAILED"
    assert len(model.sessions) == 1


@pytest.mark.anyio
async def test_empty_claude_response_is_rejected() -> None:
    with pytest.raises(InvalidModelResponseError, match="empty response"):
        await claude_with(EmptyMessages()).complete_turn(session(), provisioning_profile())


# LLM provider timeouts and outages


@pytest.mark.anyio
async def test_claude_timeout_maps_to_safe_dependency_error() -> None:
    messages = RaisingMessages(
        anthropic.APITimeoutError(
            request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        )
    )

    with pytest.raises(DependencyUnavailableError) as raised:
        await claude_with(messages).complete_turn(session(), provisioning_profile())

    assert str(raised.value) == "Anthropic request failed"
    assert API_KEY not in str(raised.value)
    assert messages.calls == 1


@pytest.mark.anyio
async def test_claude_connection_error_maps_to_safe_dependency_error() -> None:
    messages = RaisingMessages(
        anthropic.APIConnectionError(
            request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        )
    )

    with pytest.raises(DependencyUnavailableError, match="Anthropic request failed"):
        await claude_with(messages).complete_turn(session(), provisioning_profile())

    assert messages.calls == 1


def test_model_timeout_returns_safe_problem_details() -> None:
    model = FakeLanguageModel(
        "",
        error=DependencyUnavailableError("Anthropic request failed"),
    )
    client, _ = build_app(model)
    with client:
        session_id = start_session(client)
        response = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Create a server"},
        )

    body = response.json()
    assert response.status_code == 502
    assert body["code"] == "DEPENDENCY_UNAVAILABLE"
    assert body["title"] == "External dependency unavailable"
    assert API_KEY not in response.text
    assert "Traceback" not in response.text
    assert len(model.sessions) == 1


# Missing or tampered prompt-registry context


def test_tampered_prompt_hash_is_rejected_before_model_call() -> None:
    model = FakeLanguageModel("unused")
    client, state = build_app(model)
    with client:
        session_id = start_session(client)
        stored = client.portal.call(state.get_session, session_id)
        stored.prompt_hash = "0" * 64
        client.portal.call(state.save_session, stored)
        response = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Create a server"},
        )

    assert response.status_code == 500
    assert response.json()["code"] == "PROMPT_INTEGRITY_ERROR"
    assert model.sessions == []


def test_removed_prompt_version_is_rejected_before_model_call() -> None:
    model = FakeLanguageModel("unused")
    client, state = build_app(model)
    with client:
        session_id = start_session(client)
        stored = client.portal.call(state.get_session, session_id)
        stored.prompt_version = "9.9.9"
        client.portal.call(state.save_session, stored)
        response = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Create a server"},
        )

    assert response.status_code == 500
    assert response.json()["code"] == "PROMPT_INTEGRITY_ERROR"
    assert model.sessions == []
