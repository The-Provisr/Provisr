"""Tests for manifest drafting integration in AgentService.

Verifies that:
- manifest_candidate from the model triggers drafting and emits manifest.draft event.
- Policy violations convert the result to needs_clarification.
- The canonical_manifest is attached to the ModelTurnResult on success.
"""

from __future__ import annotations

import asyncio

from app.domain.drafting import PolicyConstraints
from app.domain.manifest import Ec2Resource, ResourceManifest
from app.domain.models import ModelTurnResult
from app.domain.service import AgentService
from app.integrations.state import InMemoryStateStore
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel


def _make_ec2_result(region: str = "ap-southeast-1") -> ModelTurnResult:
    return ModelTurnResult(
        outcome="manifest_candidate",
        message="Ready to provision an EC2 instance.",
        manifest=ResourceManifest(
            provider="aws",
            region=region,
            environment="production",
            tags={},
            resources=[
                Ec2Resource(
                    type="aws_ec2",
                    name="api-server",
                    instance_type="t3.medium",
                    image="ubuntu-24.04",
                )
            ],
        ),
    )


def _build_service(
    model_result: ModelTurnResult,
    *,
    policy: PolicyConstraints | None = None,
    workspace_id: str = "ws-test",
) -> tuple[AgentService, InMemoryStateStore]:
    state = InMemoryStateStore()
    model = FakeLanguageModel(model_result)
    prompt_registry = build_prompt_registry()
    service = AgentService(
        state=state,
        model=model,
        prompt_registry=prompt_registry,
        policy_constraints=policy,
        workspace_id=workspace_id,
    )
    return service, state


# ---------------------------------------------------------------------------
# Successful drafting
# ---------------------------------------------------------------------------


def test_manifest_candidate_produces_canonical_manifest_on_result() -> None:
    service, _state = _build_service(_make_ec2_result())

    async def run() -> ModelTurnResult:
        session = await service.create_session(organization_id="org", request_id="req")
        return await service.run_turn(
            session_id=session.session_id,
            message="Deploy an EC2 on AWS in ap-southeast-1 for production",
        )

    result = asyncio.run(run())
    assert result.outcome == "manifest_candidate"
    assert result.canonical_manifest is not None
    assert result.canonical_manifest.region == "ap-southeast-1"
    assert result.canonical_manifest.environment == "production"


def test_canonical_manifest_metadata_contains_session_context() -> None:
    service, _state = _build_service(_make_ec2_result(), workspace_id="ws-abc")

    async def run() -> ModelTurnResult:
        session = await service.create_session(organization_id="org", request_id="req-xyz")
        return await service.run_turn(
            session_id=session.session_id,
            message="Deploy an EC2 on AWS in ap-southeast-1 for production",
        )

    result = asyncio.run(run())
    assert result.canonical_manifest is not None
    assert result.canonical_manifest.metadata.workspace_id == "ws-abc"
    assert result.canonical_manifest.metadata.request_id == "req-xyz"


def test_manifest_draft_sse_event_emitted_before_manifest_proposed() -> None:
    service, state = _build_service(_make_ec2_result())

    async def run() -> list[str]:
        session = await service.create_session(organization_id="org", request_id="req")
        await service.run_turn(
            session_id=session.session_id,
            message="Deploy an EC2 on AWS in ap-southeast-1 for production",
        )
        events = await state.list_events(session.session_id, 0)
        return [e.type for e in events]

    event_types = asyncio.run(run())
    assert "manifest.draft" in event_types
    assert "manifest.proposed" in event_types
    # manifest.draft must precede manifest.proposed
    draft_idx = event_types.index("manifest.draft")
    proposed_idx = event_types.index("manifest.proposed")
    assert draft_idx < proposed_idx


def test_manifest_draft_event_data_contains_canonical_fields() -> None:
    service, state = _build_service(_make_ec2_result())

    async def run() -> dict:
        session = await service.create_session(organization_id="org", request_id="req")
        await service.run_turn(
            session_id=session.session_id,
            message="Deploy an EC2 on AWS in ap-southeast-1 for production",
        )
        events = await state.list_events(session.session_id, 0)
        draft_events = [e for e in events if e.type == "manifest.draft"]
        assert draft_events
        return draft_events[0].data

    data = asyncio.run(run())
    assert data.get("schema_version") == "1.0"
    assert data.get("provider") == "aws"
    assert data.get("region") == "ap-southeast-1"
    assert "metadata" in data
    assert "resources" in data


# ---------------------------------------------------------------------------
# Policy violation → needs_clarification
# ---------------------------------------------------------------------------


def test_policy_region_violation_converts_result_to_clarification() -> None:
    policy = PolicyConstraints(allowed_regions=("us-east-1",))
    service, _state = _build_service(_make_ec2_result(region="ap-southeast-1"), policy=policy)

    async def run() -> ModelTurnResult:
        session = await service.create_session(organization_id="org", request_id="req")
        return await service.run_turn(
            session_id=session.session_id,
            message="Deploy an EC2 on AWS in ap-southeast-1 for production",
        )

    result = asyncio.run(run())
    assert result.outcome == "needs_clarification"
    assert "policy" in result.message.lower()
    assert "ap-southeast-1" in result.message
    assert result.canonical_manifest is None


def test_policy_violation_emits_clarification_required_not_manifest_draft() -> None:
    policy = PolicyConstraints(allowed_regions=("us-east-1",))
    service, state = _build_service(_make_ec2_result(region="ap-southeast-1"), policy=policy)

    async def run() -> list[str]:
        session = await service.create_session(organization_id="org", request_id="req")
        await service.run_turn(
            session_id=session.session_id,
            message="Deploy an EC2 on AWS in ap-southeast-1 for production",
        )
        events = await state.list_events(session.session_id, 0)
        return [e.type for e in events]

    event_types = asyncio.run(run())
    assert "clarification.required" in event_types
    assert "manifest.draft" not in event_types


def test_no_policy_violation_when_constraints_empty() -> None:
    service, _state = _build_service(_make_ec2_result())

    async def run() -> ModelTurnResult:
        session = await service.create_session(organization_id="org", request_id="req")
        return await service.run_turn(
            session_id=session.session_id,
            message="Deploy an EC2 on AWS in ap-southeast-1 for production",
        )

    result = asyncio.run(run())
    assert result.outcome == "manifest_candidate"


# ---------------------------------------------------------------------------
# Needs-clarification outcome bypasses drafting
# ---------------------------------------------------------------------------


def test_clarification_outcome_skips_drafting() -> None:
    clarification_result = ModelTurnResult(
        outcome="needs_clarification",
        message="Which region should this be deployed in?",
    )
    service, _state = _build_service(clarification_result)

    async def run() -> ModelTurnResult:
        session = await service.create_session(organization_id="org", request_id="req")
        return await service.run_turn(
            session_id=session.session_id,
            # Fully qualified so gap-detection doesn't intercept first
            message="Deploy a server on AWS in ap-southeast-1 for production",
        )

    result = asyncio.run(run())
    assert result.canonical_manifest is None
