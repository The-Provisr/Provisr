"""Tests for answered-question state threading across turns.

Verifies that:
- Gap detection fast-paths before the LLM when required fields are absent.
- Answered questions are persisted and suppress re-asking on subsequent turns.
- record_clarification_answers deduplicates by field_mapping (last-write wins).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.domain.models import ModelTurnResult
from app.domain.service import AgentService
from app.integrations.state import InMemoryStateStore
from app.main import Resources, create_app
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel


def _build_client(result: ModelTurnResult) -> TestClient:
    state = InMemoryStateStore()
    model = FakeLanguageModel(result)
    prompt_registry = build_prompt_registry()
    resources = Resources(
        state=state,
        prompt_registry=prompt_registry,
        agent_service=AgentService(
            state=state,
            model=model,
            prompt_registry=prompt_registry,
        ),
    )
    return TestClient(create_app(settings=Settings(environment="test"), resources=resources))


# ---------------------------------------------------------------------------
# Gap detection fast-path (no LLM call when blocking gaps present)
# ---------------------------------------------------------------------------


def test_gap_detection_returns_clarification_without_calling_model() -> None:
    # Model result that would be returned if the model WERE called —
    # but the gap detector should intercept first.
    model_result = ModelTurnResult(
        outcome="manifest_candidate",
        message="Here is your manifest.",
        manifest={  # type: ignore[arg-type]  # intentionally wrong; should never be reached
            "schema_version": "1.0",
            "provider": "aws",
            "region": "us-east-1",
            "environment": "production",
            "resources": [{"type": "aws_ec2", "name": "api", "instance_type": "t3.medium", "image": "ubuntu-24.04"}],
        },
    )
    with _build_client(model_result) as client:
        created = client.post(
            "/v1/sessions",
            json={"organization_id": "org-1", "request_id": "req-1"},
        )
        assert created.status_code == 201
        session_id = created.json()["session"]["session_id"]

        # Send a vague message with no provider / region / environment
        turn = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "I need a server"},
        )
        assert turn.status_code == 200
        result = turn.json()["result"]
        assert result["outcome"] == "needs_clarification"
        # Structured questions must be present
        assert len(result["clarification_questions"]) > 0
        # field_mappings should cover at minimum provider, region, environment
        mappings = {q["field_mapping"] for q in result["clarification_questions"]}
        assert mappings & {"provider", "region", "environment"}


def test_clarification_questions_map_to_known_manifest_fields() -> None:
    model_result = ModelTurnResult(outcome="needs_clarification", message="What region?")
    with _build_client(model_result) as client:
        created = client.post(
            "/v1/sessions",
            json={"organization_id": "org-2", "request_id": "req-2"},
        )
        session_id = created.json()["session"]["session_id"]

        turn = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "Deploy a server"},
        )
        result = turn.json()["result"]
        assert result["outcome"] == "needs_clarification"
        for q in result["clarification_questions"]:
            # Every question must have all required envelope fields
            assert "question_id" in q
            assert "question_text" in q
            assert "input_type" in q
            assert "field_mapping" in q
            assert "required" in q
            assert isinstance(q["options"], list)


def test_gap_detection_emits_clarification_required_sse_event() -> None:
    model_result = ModelTurnResult(outcome="needs_clarification", message="What env?")
    with _build_client(model_result) as client:
        created = client.post(
            "/v1/sessions",
            json={"organization_id": "org-3", "request_id": "req-3"},
        )
        session_id = created.json()["session"]["session_id"]

        client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "I need a database"},
        )

        events = client.get(f"/v1/sessions/{session_id}/events")
        assert events.status_code == 200
        assert "event: clarification.required" in events.text
        assert "event: stream.completed" in events.text


# ---------------------------------------------------------------------------
# Answered-questions state threading across turns (anti-circular-loop)
# ---------------------------------------------------------------------------


def test_answered_questions_suppress_re_asking_in_subsequent_turn() -> None:
    """After answers are recorded, the same fields must not be re-asked."""
    state = InMemoryStateStore()
    model = FakeLanguageModel(
        ModelTurnResult(outcome="needs_clarification", message="Anything else?")
    )
    prompt_registry = build_prompt_registry()
    service = AgentService(state=state, model=model, prompt_registry=prompt_registry)

    import asyncio

    async def run() -> None:
        # Create session
        session = await service.create_session(organization_id="org", request_id="req")
        session_id = session.session_id

        # First turn: vague message → gap detection fires
        result1 = await service.run_turn(session_id=session_id, message="I need a server")
        assert result1.outcome == "needs_clarification"
        first_mappings = {q.field_mapping for q in result1.clarification_questions}
        assert first_mappings  # must have found something

        # Record answers for all detected gaps
        from app.domain.models import AnsweredQuestion
        answers = [
            AnsweredQuestion(
                question_id=q.question_id,
                field_mapping=q.field_mapping,
                answer="aws" if q.field_mapping == "provider"
                else "us-east-1" if q.field_mapping == "region"
                else "production" if q.field_mapping == "environment"
                else "t3.medium",
            )
            for q in result1.clarification_questions
        ]
        await service.record_clarification_answers(session_id=session_id, answers=answers)

        # Second turn with the same vague message: gaps already answered → no re-ask
        result2 = await service.run_turn(session_id=session_id, message="I need a server")
        second_mappings = {q.field_mapping for q in result2.clarification_questions}
        # None of the previously answered fields should appear again
        assert not (first_mappings & second_mappings), (
            f"Re-asked fields: {first_mappings & second_mappings}"
        )

    asyncio.run(run())


def test_record_clarification_answers_deduplicates_by_field_mapping() -> None:
    """Last-write wins: submitting the same field twice keeps only the latest."""
    state = InMemoryStateStore()
    model = FakeLanguageModel(
        ModelTurnResult(outcome="needs_clarification", message="Which region?")
    )
    prompt_registry = build_prompt_registry()
    service = AgentService(state=state, model=model, prompt_registry=prompt_registry)

    import asyncio

    from app.domain.models import AnsweredQuestion

    async def run() -> None:
        session = await service.create_session(organization_id="org", request_id="req")
        session_id = session.session_id

        # Submit two answers for the same field_mapping
        await service.record_clarification_answers(
            session_id=session_id,
            answers=[
                AnsweredQuestion(question_id="region", field_mapping="region", answer="us-east-1"),
                AnsweredQuestion(question_id="region", field_mapping="region", answer="ap-southeast-1"),
            ],
        )

        updated = await state.get_session(session_id)
        region_answers = [a for a in updated.answered_questions if a.field_mapping == "region"]
        assert len(region_answers) == 1
        assert region_answers[0].answer == "ap-southeast-1"  # last-write wins

    asyncio.run(run())


def test_full_message_with_all_required_fields_passes_gap_detection() -> None:
    """A fully-specified message should reach the model (no fast-path block)."""
    # Model returns manifest_candidate to confirm it was actually called
    state = InMemoryStateStore()
    model = FakeLanguageModel(
        ModelTurnResult(
            outcome="manifest_candidate",
            message="Ready to provision.",
            manifest=None,  # service doesn't enforce manifest presence in tests
        )
    )
    prompt_registry = build_prompt_registry()
    service = AgentService(state=state, model=model, prompt_registry=prompt_registry)

    import asyncio

    async def run() -> None:
        session = await service.create_session(organization_id="org", request_id="req")
        result = await service.run_turn(
            session_id=session.session_id,
            message="Deploy postgres on AWS in us-east-1 for production",
        )
        # Should have gone to the model, not the fast-path
        assert len(model.sessions) == 1, "Model should have been called once"
        # Result is whatever the model returned (manifest_candidate)
        assert result.outcome == "manifest_candidate"

    asyncio.run(run())
