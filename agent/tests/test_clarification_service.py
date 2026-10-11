"""Tests for answered-question state threading across turns.

Verifies that:
- Gap detection fast-paths before the LLM when required fields are absent.
- Answered questions are persisted and suppress re-asking on subsequent turns.
- record_clarification_answers deduplicates by field_mapping (last-write wins).
- Confirmed answers are injected into the model prompt.
"""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.domain.models import AnsweredQuestion
from app.domain.service import AgentService
from app.integrations.state import InMemoryStateStore
from app.main import Resources, create_app
from app.profiles.catalog import build_profile_selector
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel, FakePolicyRequirementsTool

REQUEST_ID = UUID("8b8c64dc-6607-4a45-aa71-f51b2d381cdf")

# Mentions provider, region, environment and a database engine so gap detection
# stays out of the way and the turn reaches the model.
FULLY_SPECIFIED = "Deploy postgres on AWS in us-east-1 for production"


def envelope(output_type: str, data: dict[str, object]) -> str:
    return json.dumps(
        {
            "type": output_type,
            "version": "1.0.0",
            "request_id": str(REQUEST_ID),
            "data": data,
            "metadata": {"confidence": 0.9, "source": "llm_generated", "warnings": []},
        }
    )


def build_service(raw_output: str):
    state = InMemoryStateStore()
    model = FakeLanguageModel(raw_output)
    selector = build_profile_selector(build_prompt_registry())
    policy_tool = FakePolicyRequirementsTool()
    service = AgentService(
        state=state,
        model=model,
        profile_selector=selector,
        policy_tool=policy_tool,
    )
    return service, state, model, policy_tool


async def create_session(service: AgentService):
    return await service.create_session(organization_id="org-1", request_id=REQUEST_ID)


# ---------------------------------------------------------------------------
# Gap detection fast-path (no LLM call when blocking gaps present)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_gap_detection_clarifies_without_calling_model() -> None:
    service, _, model, policy_tool = build_service(
        envelope("assistant_message", {"message": "should never be reached"})
    )
    session = await create_session(service)

    result = await service.run_turn(session_id=session.session_id, message="I need a server")

    assert result.type == "clarification_question"
    assert result.request_id == REQUEST_ID
    assert result.data.field_mapping in {"provider", "region", "environment"}
    assert result.data.question_id
    assert result.data.input_type in {"text", "select", "multi_select", "boolean", "confirmation"}
    # Neither the model nor the policy tool should have been touched.
    assert model.sessions == []
    assert policy_tool.sessions == []


@pytest.mark.anyio
async def test_gap_detection_emits_replayable_events_via_api() -> None:
    state = InMemoryStateStore()
    model = FakeLanguageModel(envelope("assistant_message", {"message": "unused"}))
    selector = build_profile_selector(build_prompt_registry())
    policy_tool = FakePolicyRequirementsTool()
    resources = Resources(
        state=state,
        prompt_registry=build_prompt_registry(),
        profile_selector=selector,
        policy_tool=policy_tool,
        agent_service=AgentService(
            state=state,
            model=model,
            profile_selector=selector,
            policy_tool=policy_tool,
        ),
    )
    app = create_app(settings=Settings(environment="test"), resources=resources)

    with TestClient(app) as client:
        created = client.post(
            "/v1/sessions",
            json={"organization_id": "org-1", "request_id": str(REQUEST_ID)},
        )
        session_id = created.json()["session"]["session_id"]

        turn = client.post(
            f"/v1/sessions/{session_id}/turns",
            json={"message": "I need a database"},
        )
        assert turn.status_code == 200
        assert turn.json()["result"]["type"] == "clarification_question"

        events = client.get(f"/v1/sessions/{session_id}/events")

    assert "event: clarification.required" in events.text
    assert "event: stream.completed" in events.text


# ---------------------------------------------------------------------------
# Answered-questions state threading (anti-circular-loop)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_answered_questions_suppress_re_asking() -> None:
    service, _, _, _ = build_service(envelope("assistant_message", {"message": "unused"}))
    session = await create_session(service)

    first = await service.run_turn(session_id=session.session_id, message="I need a server")
    assert first.type == "clarification_question"
    answered_field = first.data.field_mapping
    assert answered_field is not None

    await service.record_clarification_answers(
        session_id=session.session_id,
        answers=[
            AnsweredQuestion(
                question_id=first.data.question_id or answered_field,
                field_mapping=answered_field,
                answer="aws" if answered_field == "provider" else "us-east-1",
            )
        ],
    )

    second = await service.run_turn(session_id=session.session_id, message="I need a server")
    assert second.type == "clarification_question"
    assert second.data.field_mapping != answered_field


@pytest.mark.anyio
async def test_record_clarification_answers_deduplicates_by_field_mapping() -> None:
    service, state, _, _ = build_service(envelope("assistant_message", {"message": "unused"}))
    session = await create_session(service)

    await service.record_clarification_answers(
        session_id=session.session_id,
        answers=[
            AnsweredQuestion(question_id="region", field_mapping="region", answer="us-east-1"),
            AnsweredQuestion(question_id="region", field_mapping="region", answer="ap-southeast-1"),
        ],
    )

    stored = await state.get_session(session.session_id)
    region_answers = [a for a in stored.answered_questions if a.field_mapping == "region"]
    assert len(region_answers) == 1
    assert region_answers[0].answer == "ap-southeast-1"


@pytest.mark.anyio
async def test_confirmed_answers_are_injected_into_model_prompt() -> None:
    service, _, model, _ = build_service(
        envelope("assistant_message", {"message": "Acknowledged."})
    )
    session = await create_session(service)

    await service.record_clarification_answers(
        session_id=session.session_id,
        answers=[
            AnsweredQuestion(question_id="region", field_mapping="region", answer="us-east-1")
        ],
    )

    result = await service.run_turn(session_id=session.session_id, message=FULLY_SPECIFIED)

    assert result.type == "assistant_message"
    assert len(model.profiles) == 1
    assert "CONFIRMED CONTEXT" in model.profiles[0].prompt.content
    assert "region" in model.profiles[0].prompt.content


@pytest.mark.anyio
async def test_fully_specified_message_reaches_the_model() -> None:
    service, _, model, policy_tool = build_service(
        envelope("assistant_message", {"message": "Ready to provision."})
    )
    session = await create_session(service)

    result = await service.run_turn(session_id=session.session_id, message=FULLY_SPECIFIED)

    assert result.type == "assistant_message"
    assert len(model.sessions) == 1
    assert len(policy_tool.sessions) == 1
