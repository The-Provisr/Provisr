import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.schemas import AgentDispatchResponse, AgentToolCall
from app.config.settings import Settings
from app.domain.service import AgentService
from app.integrations.state import InMemoryStateStore
from app.main import Resources, create_app
from app.profiles.catalog import build_profile_selector
from app.prompts.catalog import build_prompt_registry
from app.prompts.provisioning import PROVISIONING_AGENT_V1_1
from tests.fakes import FakeDispatcher, FakeLanguageModel

REQUEST_ID = "8b8c64dc-6607-4a45-aa71-f51b2d381cdf"

def clarification_output(request_id: str = REQUEST_ID) -> str:
    return json.dumps(
        {
            "type": "clarification_question",
            "version": "1.0.0",
            "request_id": request_id,
            "data": {"question": "Which AWS region should host this workload?"},
            "metadata": {
                "confidence": 1.0,
                "source": "llm_generated",
                "warnings": [],
            },
        }
    )


def build_client(
    raw_output: str,
    dispatcher: FakeDispatcher | None = None,
) -> TestClient:
    state = InMemoryStateStore()
    model = FakeLanguageModel(raw_output)
    prompt_registry = build_prompt_registry()
    profile_selector = build_profile_selector(prompt_registry)
    resources = Resources(
        state=state,
        prompt_registry=prompt_registry,
        profile_selector=profile_selector,
        agent_service=AgentService(
            state=state,
            model=model,
            profile_selector=profile_selector,
        ),
        dispatcher=dispatcher or FakeDispatcher(AgentDispatchResponse()),
    )
    app = create_app(settings=Settings(environment="test"), resources=resources)
    return TestClient(app)


def create_session(client: TestClient, **extra: object):
    return client.post(
        "/v1/sessions",
        json={"organization_id": "org-1", "request_id": REQUEST_ID, **extra},
    )


def test_clarification_turn_generates_replayable_sse_events() -> None:
    with build_client(clarification_output()) as client:
        created = create_session(client)
        assert created.status_code == 201
        session = created.json()["session"]
        session_id = session["session_id"]
        assert session["status"] == "ACTIVE"
        assert session["profile_id"] == "provisioning"
        assert session["prompt_profile"] == "provisioning_agent"
        assert session["prompt_version"] == "1.1.0"
        assert session["prompt_hash"] == PROVISIONING_AGENT_V1_1.content_hash
        assert session["temperature"] == 0.0
        assert session["max_tokens"] == 2048

        turn = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Create an API server"},
        )
        assert turn.status_code == 200
        assert turn.json()["result"]["type"] == "clarification_question"
        assert turn.json()["result"]["request_id"] == REQUEST_ID

        events = client.get(f"/v1/sessions/{session_id}/events")
        assert events.status_code == 200
        assert events.headers["content-type"].startswith("text/event-stream")
        assert "event: turn.started" in events.text
        assert '"profileId":"provisioning"' in events.text
        assert '"promptVersion":"1.1.0"' in events.text
        assert f'"promptHash":"{PROVISIONING_AGENT_V1_1.content_hash}"' in events.text
        assert '"temperature":0.0' in events.text
        assert '"maxTokens":2048' in events.text
        assert "event: clarification.required" in events.text
        assert "event: stream.completed" in events.text


def test_invalid_output_fails_and_audits_session() -> None:
    with build_client('{"type":"manifest_draft"}') as client:
        created = create_session(client)
        session_id = created.json()["session"]["session_id"]

        response = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Create a server"},
        )
        events = client.get(f"/v1/sessions/{session_id}/events")
        retry = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Try again"},
        )

    assert response.status_code == 502
    assert response.json()["code"] == "INVALID_MODEL_RESPONSE"
    assert "event: turn.failed" in events.text
    assert '"code":"INVALID_AGENT_OUTPUT"' in events.text
    assert retry.status_code == 409
    assert retry.json()["code"] == "SESSION_FAILED"


def test_mismatched_output_request_id_fails_validation() -> None:
    with build_client(clarification_output("7349997c-dc43-4740-ac23-8b2d37b195af")) as client:
        created = create_session(client)
        response = client.post(
            f"/v1/sessions/{created.json()['session']['session_id']}/turns",
            json={"message": "Create a server"},
        )

    assert response.status_code == 502
    assert "request_id did not match" in response.json()["detail"]


def test_unknown_session_uses_problem_details() -> None:
    with build_client(clarification_output()) as client:
        response = client.post(
            "/v1/sessions/missing/turns",
            json={"message": "Create a server"},
        )

    assert response.status_code == 404
    assert response.json()["code"] == "SESSION_NOT_FOUND"


def test_session_request_id_must_be_uuid() -> None:
    with build_client(clarification_output()) as client:
        response = client.post(
            "/v1/sessions",
            json={"organization_id": "org-1", "request_id": "not-a-uuid"},
        )

    assert response.status_code == 422


def test_unknown_prompt_version_uses_typed_registry_error() -> None:
    with build_client(clarification_output()) as client:
        response = create_session(client, prompt_version="9.0.0")

    assert response.status_code == 400
    assert response.json()["code"] == "PROMPT_VERSION_NOT_FOUND"


def test_unknown_profile_uses_typed_profile_error() -> None:
    with build_client(clarification_output()) as client:
        response = create_session(client, profile_id="unknown")

    assert response.status_code == 400
    assert response.json()["code"] == "AGENT_PROFILE_NOT_FOUND"


def test_inactive_profile_uses_typed_not_available_error() -> None:
    with build_client(clarification_output()) as client:
        response = create_session(client, profile_id="image_analysis")

    assert response.status_code == 400
    assert response.json()["code"] == "AGENT_PROFILE_NOT_AVAILABLE"


def test_dispatch_accepts_the_orchestrator_contract() -> None:
    ids = {name: str(uuid4()) for name in ["run", "session", "workspace", "user", "correlation"]}
    dispatcher = FakeDispatcher(
        AgentDispatchResponse(
            tool_calls=[
                AgentToolCall(tool_name="get_policy_requirements", ok=True, summary="loaded")
            ]
        )
    )
    with build_client(clarification_output(), dispatcher) as client:
        response = client.post(
            f"/runs/{ids['run']}/dispatch",
            json={
                "run_id": ids["run"],
                "session_id": ids["session"],
                "workspace_id": ids["workspace"],
                "user_id": ids["user"],
                "correlation_id": ids["correlation"],
                "phase": "pending_policy",
                "prompt": "Create a production API",
                "history": [],
                "question_answer": None,
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "messages": [],
        "tool_calls": [
            {"tool_name": "get_policy_requirements", "ok": True, "summary": "loaded"}
        ],
        "events": [],
    }
    assert str(dispatcher.requests[0].run_id) == ids["run"]


def test_dispatch_rejects_a_mismatched_path_run_id() -> None:
    body_ids = [str(uuid4()) for _ in range(5)]
    with build_client(clarification_output()) as client:
        response = client.post(
            f"/runs/{uuid4()}/dispatch",
            json={
                "run_id": body_ids[0],
                "session_id": body_ids[1],
                "workspace_id": body_ids[2],
                "user_id": body_ids[3],
                "correlation_id": body_ids[4],
                "phase": "pending_agent",
                "prompt": "Create a production API",
                "history": [],
            },
        )

    assert response.status_code == 400
    assert response.json()["code"] == "DISPATCH_RUN_MISMATCH"
