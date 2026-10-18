from types import SimpleNamespace
from uuid import UUID

from app.domain.clarification import detect_gaps
from app.domain.manifest import Ec2Resource, ResourceManifest
from app.domain.models import (
    CloudContext,
    ExecutionContext,
)
from app.domain.service import (
    _context_region_options,
    _context_resolved_fields,
    _manifest_cloud_context_error,
    _unsupported_selected_provider,
    _workspace_default_region,
)
from app.policy.models import PolicyRequirements

WORKSPACE = UUID("05a0cb9b-6793-4d47-ac80-c37916dc7b57")
USER = UUID("fb352dce-57ea-47ad-a0d3-849d9888a313")


def _context(
    *,
    providers: list[str] | None = None,
    regions: list[str] | None = None,
    default_region: str | None = None,
    existing_resources: list[dict[str, object]] | None = None,
    quota_limits: dict[str, float] | None = None,
) -> ExecutionContext:
    cloud = CloudContext.model_validate(
        {
            "providers": providers or ["aws"],
            "regions": regions or ["us-east-1"],
            "default_region": default_region,
            "existing_resources": existing_resources or [],
            "active_accounts": (
                [
                    {
                        "id": "0bc6e45b-4038-47d1-b392-eab5016356ef",
                        "workspace_id": str(WORKSPACE),
                        "provider": (providers or ["aws"])[0],
                        "label": "Test account",
                        "status": "active",
                        "verified_at": "2026-10-09T00:00:00Z",
                        "supported_regions": regions or ["us-east-1"],
                        "resource_counts": {"aws_ec2": 1},
                        "quota_limits": quota_limits,
                    }
                ]
                if quota_limits is not None
                else []
            ),
            "connected_providers": providers or ["aws"],
        }
    )
    return ExecutionContext(
        workspace_id=WORKSPACE,
        user_id=USER,
        policy_context=PolicyRequirements(),
        cloud_context=cloud,
    )


def _manifest(*, provider: str = "aws", region: str = "us-east-1") -> ResourceManifest:
    return ResourceManifest(
        provider=provider,
        region=region,
        environment="development",
        security={"encryption_enabled": True},
        backup={"enabled": True},
        policy={"requirements_loaded": True, "applied_constraints": []},
        resources=[
            Ec2Resource(
                type="aws_ec2",
                name="api-server",
                instance_type="t3.micro",
                image="ubuntu-24.04",
            )
        ],
    )


def test_one_connected_provider_is_resolved_without_asking() -> None:
    context = _context()
    gaps = detect_gaps(
        "Create a development web server",
        answered_questions=[],
        resolved_fields=_context_resolved_fields(context),
        connected_providers=context.cloud_context.connected_providers,
        verified_regions=_context_region_options(context, []),
    )
    assert "provider" not in {question.field_mapping for question in gaps}


def test_single_connected_unsupported_provider_is_not_replaced() -> None:
    context = _context(providers=["azure"], regions=["eastus"])
    assert "provider" in _context_resolved_fields(context)
    assert _unsupported_selected_provider(context, [], "Create a server") == "azure"


def test_explicit_connected_but_unsupported_provider_is_not_replaced() -> None:
    context = _context(providers=["aws", "azure"], regions=["us-east-1", "eastus"])
    assert _unsupported_selected_provider(context, [], "Use Azure") == "azure"


def test_multiple_providers_asks_using_only_connected_options() -> None:
    context = _context(providers=["aws", "gcp"], regions=["us-east-1", "us-west1"])
    gaps = detect_gaps(
        "Create a development web server",
        answered_questions=[],
        connected_providers=context.cloud_context.connected_providers,
        verified_regions=_context_region_options(context, []),
    )
    question = next(question for question in gaps if question.field_mapping == "provider")
    assert question.options == ["aws", "gcp"]


def test_explicit_disconnected_provider_is_replaced_with_connected_choices() -> None:
    gaps = detect_gaps(
        "Create this on AWS",
        answered_questions=[],
        connected_providers=["azure"],
    )
    question = next(question for question in gaps if question.field_mapping == "provider")
    assert question.options == ["azure"]


def test_default_region_is_tracked_as_a_resolved_workspace_choice() -> None:
    context = _context(default_region="us-east-1", regions=["us-east-1", "us-west-2"])
    assert "region" in _context_resolved_fields(context)
    assert _context_region_options(context, []) == ["us-east-1", "us-west-2"]


def test_default_region_is_used_when_user_did_not_choose_one() -> None:
    context = _context(default_region="us-east-1")
    session = SimpleNamespace(execution_context=context, answered_questions=[], messages=[])
    assert _workspace_default_region(session) == "us-east-1"


def test_explicit_region_answer_overrides_workspace_default() -> None:
    context = _context(default_region="us-east-1")
    answer = SimpleNamespace(field_mapping="region", answer="us-west-2")
    session = SimpleNamespace(execution_context=context, answered_questions=[answer], messages=[])
    assert _workspace_default_region(session) is None


def test_existing_resource_name_conflict_blocks_manifest() -> None:
    context = _context(
        existing_resources=[
            {"provider": "aws", "region": "us-east-1", "name": "API-SERVER"}
        ]
    )
    assert "already exists" in (_manifest_cloud_context_error(_manifest(), context) or "")


def test_cloud_inventory_drops_unrecognized_credential_fields() -> None:
    context = _context(
        existing_resources=[
            {
                "provider": "aws",
                "region": "us-east-1",
                "name": "existing-api",
                "secret_access_key": "must-not-enter-model-context",
            }
        ]
    )
    assert "secret_access_key" not in context.model_dump_json()


def test_disconnected_provider_never_passes_manifest_context_validation() -> None:
    context = _context(providers=["gcp"], regions=["us-east-1"])
    assert "not connected" in (_manifest_cloud_context_error(_manifest(), context) or "")


def test_quota_limit_blocks_excess_resource_count() -> None:
    context = _context(quota_limits={"aws_ec2": 1})
    assert "quota" in (_manifest_cloud_context_error(_manifest(), context) or "")


def test_quota_counts_all_new_resources_of_the_same_type() -> None:
    context = _context(quota_limits={"aws_ec2": 2})
    manifest = _manifest()
    manifest.resources.append(manifest.resources[0].model_copy(update={"name": "second-server"}))
    assert "quota" in (_manifest_cloud_context_error(manifest, context) or "")


def test_unknown_inventory_counts_do_not_imply_zero_usage() -> None:
    context = _context(quota_limits={"aws_ec2": 0})
    context.cloud_context.active_accounts[0].resource_counts = None
    assert "quota" in (_manifest_cloud_context_error(_manifest(), context) or "")
    assert context.cloud_context.active_accounts[0].resource_counts is None


def test_cloud_context_requires_verified_regions() -> None:
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CloudContext.model_validate({"providers": ["aws"], "regions": []})
