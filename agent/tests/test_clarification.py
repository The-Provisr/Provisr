"""Tests for app/domain/clarification.py — pure gap-detection functions."""

from __future__ import annotations

from app.domain.clarification import (
    AWS_REGIONS,
    build_answered_context,
    detect_gaps,
    record_answer,
)
from app.domain.models import MAX_CLARIFICATION_QUESTIONS, AnsweredQuestion, ClarificationQuestion

# ---------------------------------------------------------------------------
# detect_gaps — missing provider
# ---------------------------------------------------------------------------


def test_detects_missing_provider_when_no_cloud_keyword() -> None:
    questions = detect_gaps("I need a web server", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "provider" in field_mappings


def test_no_provider_question_when_aws_mentioned() -> None:
    questions = detect_gaps("Deploy on AWS in us-east-1 for production", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "provider" not in field_mappings


def test_no_provider_question_when_already_answered() -> None:
    answered = [AnsweredQuestion(question_id="provider", field_mapping="provider", answer="aws")]
    questions = detect_gaps("I need a server", answered_questions=answered)

    field_mappings = [q.field_mapping for q in questions]
    assert "provider" not in field_mappings


# ---------------------------------------------------------------------------
# detect_gaps — missing region
# ---------------------------------------------------------------------------


def test_detects_missing_region_when_no_region_in_message() -> None:
    questions = detect_gaps("Deploy an EC2 instance on AWS for staging", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "region" in field_mappings


def test_region_question_has_valid_aws_region_options() -> None:
    questions = detect_gaps("Deploy on AWS", answered_questions=[])

    region_qs = [q for q in questions if q.field_mapping == "region"]
    assert region_qs, "Expected a region question"
    assert set(region_qs[0].options).issubset(set(AWS_REGIONS))
    assert len(region_qs[0].options) > 0


def test_no_region_question_when_valid_region_present() -> None:
    questions = detect_gaps("Set up in ap-southeast-1 on AWS", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "region" not in field_mappings


def test_no_region_question_when_no_preference_stated() -> None:
    questions = detect_gaps("AWS, any region, production", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "region" not in field_mappings


def test_no_region_question_when_already_answered() -> None:
    answered = [
        AnsweredQuestion(question_id="region", field_mapping="region", answer="ap-southeast-1")
    ]
    questions = detect_gaps("Deploy on AWS for production", answered_questions=answered)

    field_mappings = [q.field_mapping for q in questions]
    assert "region" not in field_mappings


# ---------------------------------------------------------------------------
# detect_gaps — missing environment
# ---------------------------------------------------------------------------


def test_detects_missing_environment_when_no_env_keyword() -> None:
    questions = detect_gaps("Spin up an EC2 on AWS in us-east-1", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "environment" in field_mappings


def test_no_environment_question_when_prod_mentioned() -> None:
    questions = detect_gaps("Deploy on AWS us-east-1 production", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "environment" not in field_mappings


def test_no_environment_question_when_dev_shorthand_used() -> None:
    questions = detect_gaps("Deploy on AWS us-east-1 dev", answered_questions=[])

    field_mappings = [q.field_mapping for q in questions]
    assert "environment" not in field_mappings


def test_environment_question_has_all_valid_options() -> None:
    questions = detect_gaps("Deploy on AWS in us-east-1", answered_questions=[])

    env_qs = [q for q in questions if q.field_mapping == "environment"]
    assert env_qs, "Expected an environment question"
    assert set(env_qs[0].options) == {"development", "staging", "production", "sandbox"}


# ---------------------------------------------------------------------------
# detect_gaps — ambiguous sizing
# ---------------------------------------------------------------------------


def test_detects_ambiguous_size_keyword() -> None:
    questions = detect_gaps(
        "I need a small database on AWS in us-east-1 for production",
        answered_questions=[],
    )

    field_mappings = [q.field_mapping for q in questions]
    assert "resources[0].instance_type" in field_mappings


def test_detects_large_keyword_as_ambiguous_size() -> None:
    questions = detect_gaps(
        "Give me a large server on AWS in us-east-1 for production",
        answered_questions=[],
    )

    field_mappings = [q.field_mapping for q in questions]
    assert "resources[0].instance_type" in field_mappings


def test_no_instance_type_question_when_already_answered() -> None:
    answered = [
        AnsweredQuestion(
            question_id="instance_size",
            field_mapping="resources[0].instance_type",
            answer="t3.medium",
        )
    ]
    questions = detect_gaps(
        "I need a small server on AWS in us-east-1 for production",
        answered_questions=answered,
    )

    field_mappings = [q.field_mapping for q in questions]
    assert "resources[0].instance_type" not in field_mappings


# ---------------------------------------------------------------------------
# detect_gaps — high-availability ambiguity
# ---------------------------------------------------------------------------


def test_detects_ha_intent_as_ambiguous() -> None:
    questions = detect_gaps(
        "I need a high availability setup on AWS in us-east-1 for production",
        answered_questions=[],
    )

    field_mappings = [q.field_mapping for q in questions]
    assert "resources[0].count" in field_mappings


def test_ha_question_is_not_required() -> None:
    questions = detect_gaps(
        "Highly available API on AWS us-east-1 production",
        answered_questions=[],
    )

    ha_qs = [q for q in questions if q.field_mapping == "resources[0].count"]
    assert ha_qs, "Expected an HA count question"
    assert ha_qs[0].required is False


# ---------------------------------------------------------------------------
# detect_gaps — database engine
# ---------------------------------------------------------------------------


def test_detects_missing_db_engine_when_database_mentioned() -> None:
    questions = detect_gaps(
        "Deploy a database on AWS in us-east-1 for production",
        answered_questions=[],
    )

    field_mappings = [q.field_mapping for q in questions]
    assert "resources[0].engine" in field_mappings


def test_no_db_engine_question_when_postgres_mentioned() -> None:
    questions = detect_gaps(
        "Deploy a postgres database on AWS in us-east-1 for production",
        answered_questions=[],
    )

    field_mappings = [q.field_mapping for q in questions]
    assert "resources[0].engine" not in field_mappings


def test_no_db_engine_question_when_mysql_mentioned() -> None:
    questions = detect_gaps(
        "I need mysql on AWS us-east-1 for production",
        answered_questions=[],
    )

    field_mappings = [q.field_mapping for q in questions]
    assert "resources[0].engine" not in field_mappings


def test_db_engine_question_has_correct_options() -> None:
    questions = detect_gaps(
        "Deploy a db on AWS in us-east-1 for production",
        answered_questions=[],
    )

    engine_qs = [q for q in questions if q.field_mapping == "resources[0].engine"]
    assert engine_qs, "Expected a DB engine question"
    assert set(engine_qs[0].options) == {"postgres", "mysql"}


# ---------------------------------------------------------------------------
# detect_gaps — max cap enforcement
# ---------------------------------------------------------------------------


def test_never_returns_more_than_max_questions() -> None:
    # This message hits every detector simultaneously.
    questions = detect_gaps(
        "I need a small highly available database",
        answered_questions=[],
    )

    assert len(questions) <= MAX_CLARIFICATION_QUESTIONS


def test_returns_empty_list_when_no_gaps_detected() -> None:
    questions = detect_gaps(
        "Deploy postgres on AWS in us-east-1 for production",
        answered_questions=[],
    )

    # provider + region + environment are all present; DB engine is postgres
    assert questions == []


# ---------------------------------------------------------------------------
# detect_gaps — anti-circular-loop: all gaps already answered
# ---------------------------------------------------------------------------


def test_all_answered_questions_suppresses_all_questions() -> None:
    answered = [
        AnsweredQuestion(question_id="provider", field_mapping="provider", answer="aws"),
        AnsweredQuestion(question_id="region", field_mapping="region", answer="us-east-1"),
        AnsweredQuestion(question_id="environment", field_mapping="environment", answer="staging"),
        AnsweredQuestion(
            question_id="instance_size",
            field_mapping="resources[0].instance_type",
            answer="t3.medium",
        ),
        AnsweredQuestion(
            question_id="ha_count",
            field_mapping="resources[0].count",
            answer="2",
        ),
        AnsweredQuestion(
            question_id="db_engine",
            field_mapping="resources[0].engine",
            answer="postgres",
        ),
    ]
    questions = detect_gaps(
        "I need a small highly available database",
        answered_questions=answered,
    )

    assert questions == []


# ---------------------------------------------------------------------------
# record_answer
# ---------------------------------------------------------------------------


def test_record_answer_returns_answered_question_with_stripped_whitespace() -> None:
    question = ClarificationQuestion(
        question_id="region",
        question_text="Which region?",
        input_type="select",
        options=["us-east-1"],
        required=True,
        field_mapping="region",
    )

    answered = record_answer(question, "  ap-southeast-1  ")

    assert answered.question_id == "region"
    assert answered.field_mapping == "region"
    assert answered.answer == "ap-southeast-1"


# ---------------------------------------------------------------------------
# build_answered_context
# ---------------------------------------------------------------------------


def test_answered_context_is_empty_string_for_no_answers() -> None:
    assert build_answered_context([]) == ""


def test_answered_context_lists_all_confirmed_fields() -> None:
    answered = [
        AnsweredQuestion(question_id="region", field_mapping="region", answer="us-east-1"),
        AnsweredQuestion(
            question_id="environment", field_mapping="environment", answer="production"
        ),
    ]

    ctx = build_answered_context(answered)

    assert "CONFIRMED CONTEXT" in ctx
    assert "region" in ctx
    assert "us-east-1" in ctx
    assert "environment" in ctx
    assert "production" in ctx


def test_answered_context_ends_with_newline() -> None:
    answered = [
        AnsweredQuestion(question_id="region", field_mapping="region", answer="us-east-1")
    ]
    ctx = build_answered_context(answered)
    assert ctx.endswith("\n")
