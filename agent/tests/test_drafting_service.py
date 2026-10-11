"""Tests for canonical manifest drafting integration in AgentService.

Verifies that:
- A validated manifest_draft envelope emits a canonical `manifest.draft` event.
- The canonical draft carries session/source metadata.
- Policy violations fail the turn (enforced before drafting).
"""

from __future__ import annotations

import json
from copy import deepcopy
from uuid import UUID

import pytest

from app.domain.errors import InvalidModelResponseError
from app.domain.service import AgentService
from app.integrations.state import InMemoryStateStore
from app.policy.models import PolicyRequirements
from app.profiles.catalog import build_profile_selector
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel, FakePolicyRequirementsTool

REQUEST_ID = UUID("8b8c64dc-6607-4a45-aa71-f51b2d381cdf")
FULLY_SPECIFIED = "Deploy postgres on AWS in ap-southeast-1 for production"

COMPLIANT_MANIFEST = {
    "schema_version": "1.0",
    "provider": "aws",
    "region": "ap-southeast-1",
    "environment": "production",
    "monthly_budget_usd": 100,
    "tags": {"owner": "platform", "data-classification": "internal"},
    "security": {"encryption_enabled": True},
    "backup": {"enabled": True},
    "policy": {
        "requirements_loaded": True,
        "applied_constraints": [
            "allowed_regions",
            "max_budget",
            "required_tags",
            "prohibited_resource_types",
            "required_encryption",
            "required_backup",
        ],
    },
    "resources": [
        {
            "type": "aws_rds",
            "name": "orders-db",
            "engine": "postgres",
            "instance_class": "db.t3.medium",
            "allocated_storage_gb": 100,
        }
    ],
}


def manifest_output(manifest: dict[str, object]) -> str:
    return json.dumps(
        {
            "type": "manifest_draft",
            "version": "1.0.0",
            "request_id": str(REQUEST_ID),
            "data": {"message": "Draft ready.", "manifest": manifest},
            "metadata": {"confidence": 0.95, "source": "llm_generated", "warnings": []},
        }
    )


def build_service(raw_output: str, requirements: PolicyRequirements | None = None):
    state = InMemoryStateStore()
    model = FakeLanguageModel(raw_output)
    selector = build_profile_selector(build_prompt_registry())
    policy_tool = FakePolicyRequirementsTool(requirements)
    service = AgentService(
        state=state,
        model=model,
        profile_selector=selector,
        policy_tool=policy_tool,
    )
    return service, state


async def create_session(service: AgentService):
    return await service.create_session(organization_id="ws-abc", request_id=REQUEST_ID)


# ---------------------------------------------------------------------------
# Successful drafting
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_valid_draft_emits_canonical_manifest_draft_event() -> None:
    service, state = build_service(manifest_output(COMPLIANT_MANIFEST))
    session = await create_session(service)

    result = await service.run_turn(session_id=session.session_id, message=FULLY_SPECIFIED)

    assert result.type == "manifest_draft"
    events = await state.list_events(session.session_id, 0)
    types = [e.type for e in events]
    assert "manifest.draft" in types
    assert "manifest.proposed" in types
    assert types.index("manifest.draft") < types.index("manifest.proposed")

    draft = next(e for e in events if e.type == "manifest.draft").data
    assert draft["schema_version"] == "1.0"
    assert draft["provider"] == "aws"
    assert draft["region"] == "ap-southeast-1"
    assert "metadata" in draft
    assert draft["metadata"]["workspace_id"] == "ws-abc"
    assert draft["metadata"]["request_id"] == str(REQUEST_ID)
    assert draft["resources"]


@pytest.mark.anyio
async def test_canonical_resource_carries_source_annotation_and_policy_refs() -> None:
    service, state = build_service(manifest_output(COMPLIANT_MANIFEST))
    session = await create_session(service)

    await service.run_turn(session_id=session.session_id, message=FULLY_SPECIFIED)

    events = await state.list_events(session.session_id, 0)
    draft = next(e for e in events if e.type == "manifest.draft").data
    resource = draft["resources"][0]
    assert resource["logical_name"] == "orders-db"
    assert resource["source_metadata"]["source"] in {
        "user_prompt",
        "policy_default",
        "cloud_state",
        "ai_assumption",
    }


# ---------------------------------------------------------------------------
# Policy violations fail the turn before drafting
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_policy_violation_fails_the_turn_without_manifest_draft() -> None:
    violating = deepcopy(COMPLIANT_MANIFEST)
    violating["region"] = "us-east-1"
    policy = PolicyRequirements(allowed_regions=("ap-southeast-1",))
    service, state = build_service(manifest_output(violating), policy)
    session = await create_session(service)

    with pytest.raises(InvalidModelResponseError):
        await service.run_turn(session_id=session.session_id, message=FULLY_SPECIFIED)

    events = await state.list_events(session.session_id, 0)
    types = [e.type for e in events]
    assert "manifest.draft" not in types
    assert "turn.failed" in types


@pytest.mark.anyio
async def test_clarification_message_skips_drafting_path() -> None:
    service, state = build_service(manifest_output(COMPLIANT_MANIFEST))
    session = await create_session(service)

    result = await service.run_turn(session_id=session.session_id, message="I need a server")

    assert result.type == "clarification_question"
    events = await state.list_events(session.session_id, 0)
    assert all(e.type != "manifest.draft" for e in events)
