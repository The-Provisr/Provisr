"""Gap-detection logic for the provisioning planning loop.

This module inspects an incoming user message + existing session context and
produces structured ``ClarificationQuestion`` objects for anything that cannot
be resolved with ≥ 90% confidence.

Design rules (from AGENTS.md / PRD §9):
- Max ``MAX_CLARIFICATION_QUESTIONS`` questions per pass.
- Never re-ask a question whose ``field_mapping`` already has an entry in
  ``session.answered_questions``.
- Questions are sorted by priority so the most critical gaps come first.
- This module contains only pure functions; all side effects live in the service.
"""

from __future__ import annotations

import re
from typing import Final

from app.domain.models import (
    MAX_CLARIFICATION_QUESTIONS,
    AnsweredQuestion,
    ClarificationQuestion,
)

# ---------------------------------------------------------------------------
# Known valid AWS regions — used to detect clearly invalid region strings and
# to populate the options list for region questions.
# ---------------------------------------------------------------------------
AWS_REGIONS: Final[tuple[str, ...]] = (
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-south-1",
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "eu-central-1",
    "eu-north-1",
    "sa-east-1",
    "ca-central-1",
    "me-south-1",
    "af-south-1",
)

# ---------------------------------------------------------------------------
# Ambiguous sizing vocabulary that signals a clarification is needed.
# ---------------------------------------------------------------------------
_AMBIGUOUS_SIZE: Final[tuple[str, ...]] = (
    "small",
    "medium",
    "large",
    "big",
    "tiny",
    "huge",
    "cheap",
    "fast",
    "powerful",
    "lightweight",
    "heavy",
)

_AMBIGUOUS_HA: Final[tuple[str, ...]] = (
    "high availability",
    "highly available",
    "ha setup",
    "redundant",
    "fault tolerant",
    "multi-az",
    "multi az",
    "failover",
)

_KNOWN_PROVIDERS: Final[tuple[str, ...]] = ("aws", "azure", "gcp", "google cloud")

_AWS_REGION_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"\b(us|eu|ap|sa|ca|me|af)-[a-z]+-[0-9]\b"
)
_ENVIRONMENT_KEYWORDS: Final[dict[str, str]] = {
    "dev": "development",
    "development": "development",
    "staging": "staging",
    "stage": "staging",
    "prod": "production",
    "production": "production",
    "sandbox": "sandbox",
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def detect_gaps(
    message: str,
    *,
    answered_questions: list[AnsweredQuestion],
) -> list[ClarificationQuestion]:
    """Return structured clarification questions for gaps in *message*.

    Already-answered fields (tracked in *answered_questions*) are skipped so
    the agent never enters a circular re-asking loop.

    Returns at most ``MAX_CLARIFICATION_QUESTIONS`` questions, ordered by
    priority (most blocking first).
    """
    answered_fields = {aq.field_mapping for aq in answered_questions}
    normalized = message.lower()

    candidates: list[ClarificationQuestion] = []

    # 1 — Provider missing / ambiguous
    if "provider" not in answered_fields and not _message_mentions_provider(normalized):
        candidates.append(_question_provider())

    # 2 — Region missing or unrecognisable
    if "region" not in answered_fields:
        region_q = _check_region(normalized, answered_fields)
        if region_q is not None:
            candidates.append(region_q)

    # 3 — Environment not specified
    if "environment" not in answered_fields and not _message_mentions_environment(normalized):
        candidates.append(_question_environment())

    # 4 — Ambiguous sizing vocabulary (e.g. "small database")
    if "resources[0].instance_type" not in answered_fields and _has_ambiguous_size(normalized):
        candidates.append(_question_instance_size())

    # 5 — High-availability intent is ambiguous
    if "resources[0].count" not in answered_fields and _has_ambiguous_ha(normalized):
        candidates.append(_question_ha_count())

    # 6 — Database engine unspecified when a DB is mentioned
    if (
        "resources[0].engine" not in answered_fields
        and _mentions_database(normalized)
        and not _mentions_db_engine(normalized)
    ):
        candidates.append(_question_db_engine())

    return candidates[:MAX_CLARIFICATION_QUESTIONS]


def record_answer(
    question: ClarificationQuestion,
    answer: str,
) -> AnsweredQuestion:
    """Convert a question + raw answer string into a persisted ``AnsweredQuestion``."""
    return AnsweredQuestion(
        question_id=question.question_id,
        field_mapping=question.field_mapping,
        answer=answer.strip(),
    )


def build_answered_context(answered_questions: list[AnsweredQuestion]) -> str:
    """Produce a concise context block to prepend to the model system prompt.

    This lets the model incorporate confirmed values without re-inferring them,
    and prevents it from asking the user again for something already answered.
    """
    if not answered_questions:
        return ""

    lines = ["CONFIRMED CONTEXT (do not re-ask these fields):"]
    for aq in answered_questions:
        lines.append(f"  - {aq.field_mapping}: {aq.answer!r}")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Private helpers — detection
# ---------------------------------------------------------------------------


def _message_mentions_provider(normalized: str) -> bool:
    return any(p in normalized for p in _KNOWN_PROVIDERS)


def _check_region(
    normalized: str,
    answered_fields: set[str],
) -> ClarificationQuestion | None:
    """Return a region question only when no recognisable region is present."""
    if _AWS_REGION_PATTERN.search(normalized):
        return None
    # Tolerate explicit "no preference" phrasing
    if any(phrase in normalized for phrase in ("any region", "no preference", "don't care")):
        return None
    return _question_region()


def _message_mentions_environment(normalized: str) -> bool:
    return any(kw in normalized for kw in _ENVIRONMENT_KEYWORDS)


def _has_ambiguous_size(normalized: str) -> bool:
    return any(word in normalized for word in _AMBIGUOUS_SIZE)


def _has_ambiguous_ha(normalized: str) -> bool:
    return any(phrase in normalized for phrase in _AMBIGUOUS_HA)


def _mentions_database(normalized: str) -> bool:
    return any(word in normalized for word in ("database", "db", "rds", "postgres", "mysql"))


def _mentions_db_engine(normalized: str) -> bool:
    return any(engine in normalized for engine in ("postgres", "postgresql", "mysql", "aurora"))


# ---------------------------------------------------------------------------
# Private helpers — question factories
# ---------------------------------------------------------------------------


def _question_provider() -> ClarificationQuestion:
    return ClarificationQuestion(
        question_id="provider",
        question_text=(
            "Which cloud provider should host this infrastructure? "
            "Currently supported: AWS."
        ),
        input_type="select",
        options=["aws"],
        required=True,
        field_mapping="provider",
    )


def _question_region() -> ClarificationQuestion:
    return ClarificationQuestion(
        question_id="region",
        question_text="Which AWS region should host this workload?",
        input_type="select",
        options=list(AWS_REGIONS),
        required=True,
        field_mapping="region",
    )


def _question_environment() -> ClarificationQuestion:
    return ClarificationQuestion(
        question_id="environment",
        question_text=(
            "What environment is this for? "
            "(development, staging, production, or sandbox)"
        ),
        input_type="select",
        options=["development", "staging", "production", "sandbox"],
        required=True,
        field_mapping="environment",
    )


def _question_instance_size() -> ClarificationQuestion:
    return ClarificationQuestion(
        question_id="instance_size",
        question_text=(
            "You mentioned a size like 'small' or 'large'. "
            "Which EC2 instance type best fits your workload? "
            "For example: t3.micro, t3.medium, m5.large, or c5.xlarge."
        ),
        input_type="text",
        options=[],
        required=True,
        field_mapping="resources[0].instance_type",
    )


def _question_ha_count() -> ClarificationQuestion:
    return ClarificationQuestion(
        question_id="ha_count",
        question_text=(
            "You mentioned high availability. "
            "How many instances do you need? (1 = single, 2+ = multi-instance)"
        ),
        input_type="select",
        options=["1", "2", "3", "4", "6"],
        required=False,
        field_mapping="resources[0].count",
    )


def _question_db_engine() -> ClarificationQuestion:
    return ClarificationQuestion(
        question_id="db_engine",
        question_text="Which database engine do you need? (postgres or mysql)",
        input_type="select",
        options=["postgres", "mysql"],
        required=True,
        field_mapping="resources[0].engine",
    )
