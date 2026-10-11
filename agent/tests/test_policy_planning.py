import json
from copy import deepcopy
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.domain.errors import InvalidModelResponseError
from app.domain.manifest import ResourceManifest
from app.domain.models import AgentSession
from app.domain.service import AgentService
from app.integrations.state import InMemoryStateStore
from app.outputs.runtime import render_runtime_system_prompt
from app.policy.compliance import validate_manifest_policy
from app.policy.errors import PolicyRequirementsUnavailableError
from app.policy.mcp import MCPPolicyRequirementsTool
from app.policy.models import PolicyRequirements
from app.policy.tool import PolicyRequirementsTool
from app.profiles.catalog import build_profile_selector
from app.prompts.catalog import build_prompt_registry
from tests.fakes import FakeLanguageModel, FakePolicyRequirementsTool

REQUEST_ID = UUID("8b8c64dc-6607-4a45-aa71-f51b2d381cdf")
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


class FakeMCPToolCaller:
    def __init__(self, result: object) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, object], AgentSession]] = []

    async def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, object],
        session: AgentSession,
    ) -> object:
        self.calls.append((tool_name, arguments, session))
        return self.result


def requirements() -> PolicyRequirements:
    return PolicyRequirements(
        allowed_regions=("ap-southeast-1", "ap-south-1"),
        max_budget=200,
        required_tags={"owner": "platform", "data-classification": "internal"},
        prohibited_resource_types=("aws_ec2",),
        required_encryption=True,
        required_backup=True,
    )


def manifest_output(manifest: dict[str, object]) -> str:
    return json.dumps(
        {
            "type": "manifest_draft",
            "version": "1.0.0",
            "request_id": str(REQUEST_ID),
            "data": {"message": "Drafted a policy-compliant manifest.", "manifest": manifest},
            "metadata": {
                "confidence": 0.96,
                "source": "llm_generated",
                "warnings": [],
            },
        }
    )


def build_service(
    raw_output: str,
    policy_tool: PolicyRequirementsTool,
    *,
    order: list[str] | None = None,
) -> tuple[AgentService, InMemoryStateStore, FakeLanguageModel]:
    state = InMemoryStateStore()
    model = FakeLanguageModel(raw_output, order)
    prompt_registry = build_prompt_registry()
    selector = build_profile_selector(prompt_registry)
    service = AgentService(
        state=state,
        model=model,
        profile_selector=selector,
        policy_tool=policy_tool,
    )
    return service, state, model


async def create_session(service: AgentService):
    return await service.create_session(
        organization_id="org-1",
        request_id=REQUEST_ID,
    )


@pytest.mark.anyio
async def test_loads_policy_before_model_and_stores_it_in_context() -> None:
    order: list[str] = []
    policy_tool = FakePolicyRequirementsTool(requirements(), order=order)
    service, state, model = build_service(
        manifest_output(COMPLIANT_MANIFEST),
        policy_tool,
        order=order,
    )
    session = await create_session(service)

    result = await service.run_turn(session_id=session.session_id, message="Create an orders DB")
    stored = await state.get_session(session.session_id)

    assert result.type == "manifest_draft"
    assert order == ["policy", "model"]
    assert len(policy_tool.sessions) == 1
    assert model.sessions[0].policy_requirements_loaded is True
    assert model.sessions[0].policy_requirements == requirements()
    assert stored.policy_requirements_loaded is True
    assert stored.policy_requirements == requirements()


@pytest.mark.anyio
async def test_reuses_policy_context_without_calling_tool_again() -> None:
    policy_tool = FakePolicyRequirementsTool(requirements())
    service, _, model = build_service(manifest_output(COMPLIANT_MANIFEST), policy_tool)
    session = await create_session(service)

    await service.run_turn(session_id=session.session_id, message="Create an orders DB")
    await service.run_turn(session_id=session.session_id, message="Keep the same requirements")

    assert len(policy_tool.sessions) == 1
    assert len(model.sessions) == 2


@pytest.mark.anyio
async def test_policy_tool_failure_blocks_model_and_marks_session_failed() -> None:
    order: list[str] = []
    policy_tool = FakePolicyRequirementsTool(
        error=PolicyRequirementsUnavailableError("Policy MCP timed out"),
        order=order,
    )
    service, state, model = build_service(
        manifest_output(COMPLIANT_MANIFEST),
        policy_tool,
        order=order,
    )
    session = await create_session(service)

    with pytest.raises(PolicyRequirementsUnavailableError, match="timed out"):
        await service.run_turn(session_id=session.session_id, message="Create a database")

    stored = await state.get_session(session.session_id)
    events = await state.list_events(session.session_id, 0)
    assert order == ["policy"]
    assert model.sessions == []
    assert stored.status == "FAILED"
    assert events[-1].type == "turn.failed"
    assert events[-1].data["code"] == "POLICY_REQUIREMENTS_UNAVAILABLE"


def test_compliant_manifest_applies_every_constraint() -> None:
    manifest = ResourceManifest.model_validate(COMPLIANT_MANIFEST)

    assert validate_manifest_policy(manifest, requirements()) == ()


def test_detects_region_budget_tags_type_encryption_and_backup_violations() -> None:
    manifest_payload = deepcopy(COMPLIANT_MANIFEST)
    manifest_payload.update(
        {
            "region": "us-east-1",
            "monthly_budget_usd": 500,
            "tags": {"owner": "another-team"},
            "security": {"encryption_enabled": False},
            "backup": {"enabled": False},
            "resources": [
                {
                    "type": "aws_ec2",
                    "name": "legacy-server",
                    "instance_type": "t3.large",
                    "image": "ami-12345678",
                }
            ],
        }
    )
    manifest = ResourceManifest.model_validate(manifest_payload)

    violations = validate_manifest_policy(manifest, requirements())

    assert {violation.code for violation in violations} == {
        "region_not_allowed",
        "budget_exceeded",
        "required_tags_missing",
        "resource_type_prohibited",
        "encryption_required",
        "backup_required",
    }
    assert all(violation.alternatives for violation in violations)


@pytest.mark.anyio
async def test_rejects_manifest_that_conflicts_with_loaded_policy() -> None:
    conflicting = deepcopy(COMPLIANT_MANIFEST)
    conflicting["region"] = "us-east-1"
    policy_tool = FakePolicyRequirementsTool(requirements())
    service, state, _ = build_service(manifest_output(conflicting), policy_tool)
    session = await create_session(service)

    with pytest.raises(InvalidModelResponseError, match="Region.*not allowed"):
        await service.run_turn(session_id=session.session_id, message="Use us-east-1")

    stored = await state.get_session(session.session_id)
    assert stored.status == "FAILED"


def test_runtime_prompt_contains_constraints_and_conflict_instructions() -> None:
    selector = build_profile_selector(build_prompt_registry())
    profile = selector.select_profile("provisioning")

    prompt = render_runtime_system_prompt(profile, REQUEST_ID, requirements())

    assert '"allowed_regions":["ap-southeast-1","ap-south-1"]' in prompt
    assert '"required_encryption":true' in prompt
    assert "suggest compliant alternatives" in prompt
    assert "ask the user to confirm" in prompt


def test_rejects_enabled_policy_without_allowed_regions() -> None:
    with pytest.raises(ValidationError, match="at least one allowed region"):
        PolicyRequirements(enabled=True)


def test_budget_policy_cannot_be_omitted_from_manifest() -> None:
    payload = deepcopy(COMPLIANT_MANIFEST)
    payload["monthly_budget_usd"] = None
    manifest = ResourceManifest.model_validate(payload)

    violations = validate_manifest_policy(manifest, requirements())

    assert "budget_limit_missing" in {violation.code for violation in violations}


def test_manifest_must_reference_every_applicable_policy_constraint() -> None:
    payload = deepcopy(COMPLIANT_MANIFEST)
    payload["policy"] = {
        "requirements_loaded": True,
        "applied_constraints": ["allowed_regions"],
    }
    manifest = ResourceManifest.model_validate(payload)

    violations = validate_manifest_policy(manifest, requirements())

    reference_violation = next(
        violation for violation in violations if violation.code == "policy_reference_missing"
    )
    assert "required_encryption" in reference_violation.alternatives[0]


@pytest.mark.anyio
async def test_mcp_adapter_calls_exact_required_tool_and_validates_result() -> None:
    caller = FakeMCPToolCaller(requirements().model_dump(mode="json"))
    tool = MCPPolicyRequirementsTool(caller)
    service, _, _ = build_service(manifest_output(COMPLIANT_MANIFEST), tool)
    session = await create_session(service)

    result = await tool.get_policy_requirements(session)

    assert result == requirements()
    assert caller.calls == [("get_policy_requirements", {}, session)]


@pytest.mark.anyio
async def test_mcp_adapter_rejects_malformed_tool_result() -> None:
    caller = FakeMCPToolCaller({"allowed_regions": []})
    tool = MCPPolicyRequirementsTool(caller)
    service, _, _ = build_service(manifest_output(COMPLIANT_MANIFEST), tool)
    session = await create_session(service)

    with pytest.raises(PolicyRequirementsUnavailableError, match="invalid response"):
        await tool.get_policy_requirements(session)
