from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.domain.models import ModelTurnResult
from app.domain.service import AgentService
from app.integrations.state import InMemoryStateStore
from app.main import Resources, create_app
from tests.fakes import FakeLanguageModel


def build_client(result: ModelTurnResult) -> TestClient:
    state = InMemoryStateStore()
    model = FakeLanguageModel(result)
    resources = Resources(state=state, agent_service=AgentService(state=state, model=model))
    app = create_app(settings=Settings(environment="test"), resources=resources)
    return TestClient(app)


def test_clarification_turn_generates_replayable_sse_events() -> None:
    with build_client(
        ModelTurnResult(
            outcome="needs_clarification",
            message="Which AWS region should host this workload?",
        )
    ) as client:
        created = client.post(
            "/v1/sessions",
            json={"organization_id": "org-1", "request_id": "req-1"},
        )
        assert created.status_code == 201
        session_id = created.json()["session"]["session_id"]

        turn = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Create an API server"},
        )
        assert turn.status_code == 200
        assert turn.json()["result"]["outcome"] == "needs_clarification"

        events = client.get(f"/v1/sessions/{session_id}/events")
        assert events.status_code == 200
        assert events.headers["content-type"].startswith("text/event-stream")
        assert "event: turn.started" in events.text
        assert "event: clarification.required" in events.text
        assert "event: stream.completed" in events.text


def test_unknown_session_uses_problem_details() -> None:
    with build_client(
        ModelTurnResult(outcome="needs_clarification", message="What environment?")
    ) as client:
        response = client.post(
            "/v1/sessions/missing/turns",
            json={"message": "Create a server"},
        )

    assert response.status_code == 404
    assert response.json()["code"] == "SESSION_NOT_FOUND"
