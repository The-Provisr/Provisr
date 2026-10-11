from __future__ import annotations

from dataclasses import dataclass

from app.domain.manifest import ResourceManifest
from app.policy.models import PolicyRequirements


@dataclass(frozen=True, slots=True)
class PolicyViolation:
    code: str
    message: str
    alternatives: tuple[str, ...]


def validate_manifest_policy(
    manifest: ResourceManifest,
    requirements: PolicyRequirements,
) -> tuple[PolicyViolation, ...]:
    """Deterministically reject known manifest conflicts before orchestration."""

    if not requirements.enabled:
        return ()

    violations: list[PolicyViolation] = []
    expected_references = {"allowed_regions"}
    if requirements.max_budget is not None:
        expected_references.add("max_budget")
    if requirements.required_tags:
        expected_references.add("required_tags")
    if requirements.prohibited_resource_types:
        expected_references.add("prohibited_resource_types")
    if requirements.required_encryption:
        expected_references.add("required_encryption")
    if requirements.required_backup:
        expected_references.add("required_backup")

    missing_references = expected_references - set(manifest.policy.applied_constraints)
    if missing_references:
        violations.append(
            PolicyViolation(
                code="policy_reference_missing",
                message="The manifest does not reference every applied workspace policy constraint.",
                alternatives=(
                    "Reference these policy constraints in policy.applied_constraints: "
                    + ", ".join(sorted(missing_references)),
                ),
            )
        )

    if manifest.region not in requirements.allowed_regions:
        violations.append(
            PolicyViolation(
                code="region_not_allowed",
                message=f"Region {manifest.region!r} is not allowed by workspace policy.",
                alternatives=tuple(
                    f"Use allowed region {region!r}." for region in requirements.allowed_regions
                ),
            )
        )

    if requirements.max_budget is not None:
        if manifest.monthly_budget_usd is None:
            violations.append(
                PolicyViolation(
                    code="budget_limit_missing",
                    message="The manifest does not reference the workspace policy budget limit.",
                    alternatives=(
                        f"Set a monthly budget no greater than {requirements.max_budget:g} USD.",
                    ),
                )
            )
        elif manifest.monthly_budget_usd > requirements.max_budget:
            violations.append(
                PolicyViolation(
                    code="budget_exceeded",
                    message="The manifest budget exceeds the workspace policy limit.",
                    alternatives=(
                        f"Use a monthly budget no greater than {requirements.max_budget:g} USD.",
                        "Reduce resource capacity or choose lower-cost compliant resources.",
                    ),
                )
            )

    missing_tags = {
        key: value
        for key, value in requirements.required_tags.items()
        if manifest.tags.get(key) != value
    }
    if missing_tags:
        violations.append(
            PolicyViolation(
                code="required_tags_missing",
                message="The manifest is missing required workspace policy tags.",
                alternatives=(
                    "Add these required tags: "
                    + ", ".join(f"{key}={value}" for key, value in sorted(missing_tags.items())),
                ),
            )
        )

    prohibited = sorted(
        {resource.type for resource in manifest.resources}
        & set(requirements.prohibited_resource_types)
    )
    if prohibited:
        violations.append(
            PolicyViolation(
                code="resource_type_prohibited",
                message="The manifest contains resource types prohibited by workspace policy.",
                alternatives=(
                    "Remove or replace these prohibited resource types: " + ", ".join(prohibited),
                ),
            )
        )

    if requirements.required_encryption and not manifest.security.encryption_enabled:
        violations.append(
            PolicyViolation(
                code="encryption_required",
                message="Workspace policy requires encryption for this manifest.",
                alternatives=("Enable encryption in the manifest security settings.",),
            )
        )

    if requirements.required_backup and not manifest.backup.enabled:
        violations.append(
            PolicyViolation(
                code="backup_required",
                message="Workspace policy requires backups for this manifest.",
                alternatives=("Enable backups in the manifest backup settings.",),
            )
        )

    return tuple(violations)
