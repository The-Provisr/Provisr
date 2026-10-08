"""Tests for app/domain/drafting.py — canonical manifest drafting and policy pre-flight."""

from __future__ import annotations

import pytest

from app.domain.drafting import (
    DraftingContext,
    PolicyConstraints,
    PolicyViolationError,
    check_policy_preflight,
    draft_manifest,
)
from app.domain.manifest import (
    Ec2Resource,
    RdsResource,
    ResourceManifest,
    S3Resource,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ec2_manifest(
    *,
    region: str = "ap-southeast-1",
    environment: str = "production",
    budget: float | None = None,
    tags: dict[str, str] | None = None,
    count: int = 1,
) -> ResourceManifest:
    return ResourceManifest(
        provider="aws",
        region=region,
        environment=environment,  # type: ignore[arg-type]
        monthly_budget_usd=budget,
        tags=tags or {},
        resources=[
            Ec2Resource(
                type="aws_ec2",
                name="api-server",
                instance_type="t3.medium",
                image="ubuntu-24.04",
                count=count,
            )
        ],
    )


def _rds_manifest(
    *,
    region: str = "ap-southeast-1",
    environment: str = "production",
) -> ResourceManifest:
    return ResourceManifest(
        provider="aws",
        region=region,
        environment=environment,  # type: ignore[arg-type]
        tags={},
        resources=[
            RdsResource(
                type="aws_rds",
                name="main-db",
                engine="postgres",
                instance_class="db.t3.micro",
                allocated_storage_gb=20,
            )
        ],
    )


def _s3_manifest(*, region: str = "us-east-1") -> ResourceManifest:
    return ResourceManifest(
        provider="aws",
        region=region,
        environment="development",
        tags={},
        resources=[
            S3Resource(
                type="aws_s3",
                name="my-test-bucket",
            )
        ],
    )


def _ctx(
    *,
    policy: PolicyConstraints | None = None,
    workspace_id: str = "ws-1",
    request_id: str = "req-1",
    user_prompt: str = "Deploy a server",
) -> DraftingContext:
    return DraftingContext(
        request_id=request_id,
        workspace_id=workspace_id,
        user_prompt=user_prompt,
        policy=policy or PolicyConstraints(),
    )


# ---------------------------------------------------------------------------
# draft_manifest — basic structure
# ---------------------------------------------------------------------------


def test_draft_manifest_produces_canonical_manifest() -> None:
    manifest = _ec2_manifest()
    result = draft_manifest(manifest, _ctx())

    assert result.schema_version == "1.0"
    assert result.provider == "aws"
    assert result.region == "ap-southeast-1"
    assert result.environment == "production"


def test_draft_manifest_populates_metadata() -> None:
    ctx = _ctx(workspace_id="ws-abc", request_id="req-xyz", user_prompt="I need a server")
    result = draft_manifest(_ec2_manifest(), ctx)

    assert result.metadata.workspace_id == "ws-abc"
    assert result.metadata.request_id == "req-xyz"
    assert result.metadata.user_prompt == "I need a server"


def test_draft_manifest_produces_canonical_resources() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())

    assert len(result.resources) == 1
    r = result.resources[0]
    assert r.logical_name == "api-server"
    assert r.type == "aws_ec2"


def test_draft_manifest_resources_carry_provider_config() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())

    r = result.resources[0]
    assert r.provider_config.get("instance_type") == "t3.medium"
    assert r.provider_config.get("image") == "ubuntu-24.04"


def test_draft_manifest_rds_resource_has_engine_in_provider_config() -> None:
    result = draft_manifest(_rds_manifest(), _ctx())

    r = result.resources[0]
    assert r.type == "aws_rds"
    assert r.provider_config.get("engine") == "postgres"
    assert r.provider_config.get("instance_class") == "db.t3.micro"


def test_draft_manifest_s3_resource_type_preserved() -> None:
    result = draft_manifest(_s3_manifest(), _ctx())

    assert result.resources[0].type == "aws_s3"
    assert result.resources[0].logical_name == "my-test-bucket"


def test_draft_manifest_forwards_cloud_account() -> None:
    ctx = DraftingContext(
        request_id="r",
        workspace_id="w",
        user_prompt="p",
        cloud_account="123456789012",
    )
    result = draft_manifest(_ec2_manifest(), ctx)
    assert result.cloud_account == "123456789012"


# ---------------------------------------------------------------------------
# Policy tags: mandatory tags merged onto resources and top-level
# ---------------------------------------------------------------------------


def test_mandatory_tags_merged_into_manifest_tags() -> None:
    policy = PolicyConstraints(required_tags={"env": "prod", "owner": "platform"})
    result = draft_manifest(_ec2_manifest(tags={"project": "provisr"}), _ctx(policy=policy))

    assert result.tags["env"] == "prod"
    assert result.tags["owner"] == "platform"
    assert result.tags["project"] == "provisr"


def test_policy_tags_override_model_tags_on_collision() -> None:
    policy = PolicyConstraints(required_tags={"env": "prod"})
    result = draft_manifest(_ec2_manifest(tags={"env": "dev"}), _ctx(policy=policy))

    # Policy wins
    assert result.tags["env"] == "prod"


def test_resources_inherit_merged_tags() -> None:
    policy = PolicyConstraints(required_tags={"owner": "ops"})
    result = draft_manifest(_ec2_manifest(), _ctx(policy=policy))

    assert result.resources[0].tags["owner"] == "ops"


# ---------------------------------------------------------------------------
# Source annotation — region
# ---------------------------------------------------------------------------


def test_region_annotated_as_user_prompt_when_no_allowed_regions() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())

    assert result.region_source.source == "user_prompt"
    assert result.region_source.confidence == 0.95


def test_region_annotated_as_policy_default_when_in_allowed_list() -> None:
    policy = PolicyConstraints(allowed_regions=("ap-southeast-1", "us-east-1"))
    result = draft_manifest(_ec2_manifest(region="ap-southeast-1"), _ctx(policy=policy))

    assert result.region_source.source == "policy_default"
    assert result.region_source.confidence == 1.0


def test_environment_source_always_user_prompt() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())
    assert result.environment_source.source == "user_prompt"
    assert result.environment_source.confidence == 1.0


def test_provider_source_always_user_prompt() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())
    assert result.provider_source.source == "user_prompt"
    assert result.provider_source.confidence == 1.0


def test_resource_source_metadata_defaults_to_user_prompt() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())
    assert result.resources[0].source_metadata.source == "user_prompt"
    assert result.resources[0].source_metadata.confidence == 1.0


# ---------------------------------------------------------------------------
# Assumptions — low-confidence inferred values
# ---------------------------------------------------------------------------


def test_ec2_image_alias_generates_assumption() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())

    r = result.resources[0]
    image_assumptions = [a for a in r.assumptions if a.field == "image"]
    assert image_assumptions, "Expected an assumption for non-AMI image alias"
    assert image_assumptions[0].confidence < 0.9


def test_ec2_single_count_generates_assumption() -> None:
    result = draft_manifest(_ec2_manifest(count=1), _ctx())

    r = result.resources[0]
    count_assumptions = [a for a in r.assumptions if a.field == "count"]
    assert count_assumptions, "Expected an assumption for single-instance count"


def test_ec2_explicit_ami_id_does_not_generate_image_assumption() -> None:
    raw = ResourceManifest(
        provider="aws",
        region="ap-southeast-1",
        environment="production",
        tags={},
        resources=[
            Ec2Resource(
                type="aws_ec2",
                name="api",
                instance_type="t3.medium",
                image="ami-0abcdef1234567890",
                count=2,
            )
        ],
    )
    result = draft_manifest(raw, _ctx())

    r = result.resources[0]
    image_assumptions = [a for a in r.assumptions if a.field == "image"]
    assert not image_assumptions, "Real AMI IDs should not generate an assumption"


def test_rds_minimum_storage_generates_assumption() -> None:
    result = draft_manifest(_rds_manifest(), _ctx())

    r = result.resources[0]
    storage_assumptions = [a for a in r.assumptions if a.field == "allocated_storage_gb"]
    assert storage_assumptions


# ---------------------------------------------------------------------------
# Policy refs on resources
# ---------------------------------------------------------------------------


def test_resources_carry_policy_refs_when_constraints_active() -> None:
    policy = PolicyConstraints(
        allowed_regions=("ap-southeast-1",),
        required_tags={"owner": "ops"},
        max_budget=500.0,
    )
    result = draft_manifest(_ec2_manifest(region="ap-southeast-1"), _ctx(policy=policy))

    refs = result.resources[0].policy_refs
    assert "policy:allowed_regions" in refs
    assert "policy:required_tags" in refs
    assert "policy:max_budget" in refs


def test_no_policy_refs_when_no_constraints() -> None:
    result = draft_manifest(_ec2_manifest(), _ctx())

    assert result.resources[0].policy_refs == []


# ---------------------------------------------------------------------------
# Policy pre-flight — check_policy_preflight (returns list, no raise)
# ---------------------------------------------------------------------------


def test_preflight_clean_when_region_in_allowed_list() -> None:
    policy = PolicyConstraints(allowed_regions=("ap-southeast-1", "us-east-1"))
    violations = check_policy_preflight(_ec2_manifest(region="ap-southeast-1"), policy)
    assert violations == []


def test_preflight_violation_when_region_not_in_allowed_list() -> None:
    policy = PolicyConstraints(allowed_regions=("us-east-1",))
    violations = check_policy_preflight(_ec2_manifest(region="ap-southeast-1"), policy)

    assert len(violations) == 1
    assert "ap-southeast-1" in violations[0]
    assert "us-east-1" in violations[0]


def test_preflight_clean_when_no_allowed_regions_set() -> None:
    policy = PolicyConstraints()  # no region restriction
    violations = check_policy_preflight(_ec2_manifest(region="any-region-1"), policy)
    assert violations == []


def test_preflight_violation_when_budget_exceeds_max() -> None:
    policy = PolicyConstraints(max_budget=100.0)
    violations = check_policy_preflight(_ec2_manifest(budget=200.0), policy)

    assert len(violations) == 1
    assert "200.00" in violations[0]
    assert "100.00" in violations[0]


def test_preflight_clean_when_budget_within_max() -> None:
    policy = PolicyConstraints(max_budget=500.0)
    violations = check_policy_preflight(_ec2_manifest(budget=300.0), policy)
    assert violations == []


def test_preflight_clean_when_no_budget_set() -> None:
    policy = PolicyConstraints(max_budget=100.0)
    violations = check_policy_preflight(_ec2_manifest(budget=None), policy)
    assert violations == []


def test_preflight_violation_for_prohibited_resource_type() -> None:
    policy = PolicyConstraints(prohibited_resource_types=("aws_ec2",))
    violations = check_policy_preflight(_ec2_manifest(), policy)

    assert len(violations) == 1
    assert "aws_ec2" in violations[0]


def test_preflight_clean_when_resource_type_not_prohibited() -> None:
    policy = PolicyConstraints(prohibited_resource_types=("aws_lambda",))
    violations = check_policy_preflight(_ec2_manifest(), policy)
    assert violations == []


def test_preflight_collects_multiple_violations() -> None:
    policy = PolicyConstraints(
        allowed_regions=("us-east-1",),
        max_budget=50.0,
        prohibited_resource_types=("aws_ec2",),
    )
    violations = check_policy_preflight(_ec2_manifest(budget=100.0), policy)
    assert len(violations) == 3


# ---------------------------------------------------------------------------
# draft_manifest — raises PolicyViolationError on violations
# ---------------------------------------------------------------------------


def test_draft_raises_policy_violation_for_bad_region() -> None:
    policy = PolicyConstraints(allowed_regions=("us-east-1",))
    with pytest.raises(PolicyViolationError) as exc_info:
        draft_manifest(_ec2_manifest(region="ap-southeast-1"), _ctx(policy=policy))

    assert exc_info.value.violations
    assert any("ap-southeast-1" in v for v in exc_info.value.violations)


def test_draft_raises_policy_violation_for_prohibited_type() -> None:
    policy = PolicyConstraints(prohibited_resource_types=("aws_ec2",))
    with pytest.raises(PolicyViolationError) as exc_info:
        draft_manifest(_ec2_manifest(), _ctx(policy=policy))

    assert any("aws_ec2" in v for v in exc_info.value.violations)


def test_policy_violation_error_message_contains_all_violations() -> None:
    policy = PolicyConstraints(
        allowed_regions=("us-east-1",),
        max_budget=10.0,
    )
    with pytest.raises(PolicyViolationError) as exc_info:
        draft_manifest(_ec2_manifest(budget=500.0), _ctx(policy=policy))

    error_str = str(exc_info.value)
    assert "ap-southeast-1" in error_str
    assert "500.00" in error_str


def test_draft_succeeds_when_all_constraints_satisfied() -> None:
    policy = PolicyConstraints(
        allowed_regions=("ap-southeast-1",),
        max_budget=1000.0,
        required_tags={"env": "prod"},
        prohibited_resource_types=("aws_lambda",),
    )
    result = draft_manifest(
        _ec2_manifest(region="ap-southeast-1", budget=500.0),
        _ctx(policy=policy),
    )
    assert result.region == "ap-southeast-1"
    assert result.tags["env"] == "prod"
