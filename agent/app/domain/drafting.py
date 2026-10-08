"""Canonical manifest drafting and policy pre-flight.

This module synthesises a ``CanonicalManifest`` (AG-005) from:
  - The model's raw ``ResourceManifest`` candidate
  - Answered clarification questions from the session
  - Policy constraints fetched from the MCP policy server
  - Session trace context (request_id, workspace_id, user_prompt)

Design rules:
- All functions are pure (no I/O, no side-effects).
- ``PolicyViolationError`` is raised — never silently swallowed — so the
  service layer can convert it to a ``needs_clarification`` result or surface
  it as a ``turn.failed`` event.
- Confidence below 0.9 is treated as an inferred value; the caller must decide
  whether to surface it as an assumption or trigger another clarification round.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.manifest import (
    CanonicalManifest,
    CanonicalResource,
    FieldSource,
    ManifestMetadata,
    ResourceAssumption,
    ResourceManifest,
    UnknownField,
)

# ---------------------------------------------------------------------------
# Policy constraints (lightweight value object — no httpx dependency here)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PolicyConstraints:
    """Policy constraints resolved before manifest drafting begins.

    Populated from the MCP policy server response (or defaults when policies
    are disabled).  Kept as a plain dataclass so this module has zero
    external dependencies.
    """

    allowed_regions: tuple[str, ...] = field(default_factory=tuple)
    max_budget: float | None = None
    required_tags: dict[str, str] = field(default_factory=dict)
    prohibited_resource_types: tuple[str, ...] = field(default_factory=tuple)


# ---------------------------------------------------------------------------
# Drafting context — everything the drafter needs
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DraftingContext:
    """All inputs required to produce one ``CanonicalManifest``."""

    request_id: str
    workspace_id: str
    user_prompt: str
    policy: PolicyConstraints = field(default_factory=PolicyConstraints)
    cloud_account: str = ""


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class PolicyViolationError(Exception):
    """Raised when the manifest candidate violates a policy constraint.

    ``violations`` is a list of human-readable descriptions suitable for
    surfacing to the user (no raw policy internals).
    """

    def __init__(self, violations: list[str]) -> None:
        super().__init__("; ".join(violations))
        self.violations = violations


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def draft_manifest(
    raw: ResourceManifest,
    context: DraftingContext,
) -> CanonicalManifest:
    """Convert a raw model manifest into a fully-annotated ``CanonicalManifest``.

    Steps:
    1. Policy pre-flight — raises ``PolicyViolationError`` on any violation.
    2. Build enriched ``CanonicalResource`` objects with source annotations.
    3. Apply mandatory tags from policy.
    4. Annotate top-level fields with source/confidence.

    Args:
        raw: The ``ResourceManifest`` parsed from the model response.
        context: Trace context, policy constraints, and account info.

    Returns:
        A ``CanonicalManifest`` ready to be emitted as a ``manifest.draft`` event.

    Raises:
        PolicyViolationError: If any policy constraint is violated.
    """
    _run_policy_preflight(raw, context.policy)

    # Merge mandatory policy tags on top of any tags the model supplied.
    merged_tags = {**raw.tags, **context.policy.required_tags}

    resources = [
        _build_canonical_resource(r_raw, merged_tags, context.policy)
        for r_raw in raw.resources
    ]

    return CanonicalManifest(
        schema_version=raw.schema_version,
        provider=raw.provider,
        region=raw.region,
        cloud_account=context.cloud_account,
        environment=raw.environment,
        metadata=ManifestMetadata(
            request_id=context.request_id,
            workspace_id=context.workspace_id,
            user_prompt=context.user_prompt,
        ),
        tags=merged_tags,
        monthly_budget_usd=raw.monthly_budget_usd,
        resources=resources,
        region_source=_annotate_region(raw.region, context.policy),
        environment_source=FieldSource(source="user_prompt", confidence=1.0),
        provider_source=FieldSource(source="user_prompt", confidence=1.0),
    )


def check_policy_preflight(
    raw: ResourceManifest,
    policy: PolicyConstraints,
) -> list[str]:
    """Return a list of human-readable violation descriptions (empty = clean).

    Useful for tests and callers that want to inspect violations without
    catching an exception.
    """
    violations: list[str] = []
    _collect_region_violations(raw.region, policy, violations)
    _collect_budget_violations(raw.monthly_budget_usd, policy, violations)
    _collect_prohibited_type_violations(raw.resources, policy, violations)
    return violations


# ---------------------------------------------------------------------------
# Private helpers — policy pre-flight
# ---------------------------------------------------------------------------


def _run_policy_preflight(raw: ResourceManifest, policy: PolicyConstraints) -> None:
    violations = check_policy_preflight(raw, policy)
    if violations:
        raise PolicyViolationError(violations)


def _collect_region_violations(
    region: str,
    policy: PolicyConstraints,
    violations: list[str],
) -> None:
    if policy.allowed_regions and region not in policy.allowed_regions:
        allowed = ", ".join(policy.allowed_regions)
        violations.append(
            f"Region '{region}' is not in the policy-allowed set: {allowed}."
        )


def _collect_budget_violations(
    monthly_budget_usd: float | None,
    policy: PolicyConstraints,
    violations: list[str],
) -> None:
    if (
        policy.max_budget is not None
        and monthly_budget_usd is not None
        and monthly_budget_usd > policy.max_budget
    ):
        violations.append(
            f"Requested budget ${monthly_budget_usd:.2f}/mo exceeds "
            f"policy maximum of ${policy.max_budget:.2f}/mo."
        )


def _collect_prohibited_type_violations(
    resources: list[object],
    policy: PolicyConstraints,
    violations: list[str],
) -> None:
    if not policy.prohibited_resource_types:
        return
    for resource in resources:
        rtype = getattr(resource, "type", None)
        if rtype in policy.prohibited_resource_types:
            violations.append(
                f"Resource type '{rtype}' is prohibited by workspace policy."
            )


# ---------------------------------------------------------------------------
# Private helpers — canonical resource construction
# ---------------------------------------------------------------------------


def _build_canonical_resource(
    raw: object,
    manifest_tags: dict[str, str],
    policy: PolicyConstraints,
) -> CanonicalResource:
    """Convert one raw AWS resource object into a ``CanonicalResource``."""
    rtype: str = getattr(raw, "type", "unknown")
    name: str = getattr(raw, "name", "unnamed")

    # Collect all provider-specific fields (everything except type and name).
    provider_config = _extract_provider_config(raw)

    # Assumptions: fields that were not explicitly given by the user
    assumptions = _infer_assumptions(raw, rtype)

    # Unknowns: fields that should exist but have no resolvable value
    unknowns = _detect_unknowns(raw, rtype)

    # Policy refs: capture policy constraints that apply to this resource type
    policy_refs = _build_policy_refs(rtype, policy)

    return CanonicalResource(
        logical_name=name,
        type=rtype,
        provider_config=provider_config,
        tags=manifest_tags,
        policy_refs=policy_refs,
        unknowns=unknowns,
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )


def _extract_provider_config(raw: object) -> dict[str, object]:
    """Pull every field except ``type`` and ``name`` into provider_config."""
    skip = {"type", "name"}
    config: dict[str, object] = {}
    # Pydantic V2: access model_fields on the *class*, not the instance.
    if hasattr(type(raw), "model_fields"):
        for fname in type(raw).model_fields:
            if fname not in skip:
                config[fname] = getattr(raw, fname)
    else:
        for attr in vars(raw):
            if attr not in skip:
                config[attr] = getattr(raw, attr)
    return config


def _infer_assumptions(raw: object, rtype: str) -> list[ResourceAssumption]:
    """Return assumptions for values that were not explicitly set by the user.

    Currently we track the EC2 image field — when it contains a version marker
    like "ubuntu-24.04" the specific AMI ID must be resolved at execution time.
    """
    assumptions: list[ResourceAssumption] = []

    if rtype == "aws_ec2":
        image = getattr(raw, "image", None)
        if image and not image.startswith("ami-"):
            assumptions.append(
                ResourceAssumption(
                    field="image",
                    assumed_value=str(image),
                    confidence=0.85,
                    reason=(
                        "Image alias will be resolved to a region-specific AMI ID "
                        "at execution time. Confirm the alias is correct."
                    ),
                )
            )
        count = getattr(raw, "count", 1)
        if count == 1:
            assumptions.append(
                ResourceAssumption(
                    field="count",
                    assumed_value="1",
                    confidence=0.80,
                    reason="Single instance assumed; confirm if high availability is required.",
                )
            )

    if rtype == "aws_rds":
        storage = getattr(raw, "allocated_storage_gb", None)
        if storage is not None and storage == 20:
            assumptions.append(
                ResourceAssumption(
                    field="allocated_storage_gb",
                    assumed_value="20",
                    confidence=0.75,
                    reason="Minimum storage assumed; confirm if larger data volume is expected.",
                )
            )

    return assumptions


def _detect_unknowns(raw: object, rtype: str) -> list[UnknownField]:
    """Return unknown fields — required values that have no resolvable default."""
    unknowns: list[UnknownField] = []

    if rtype == "aws_ec2" and not getattr(raw, "instance_type", None):
        unknowns.append(
            UnknownField(
                field="instance_type",
                reason="EC2 instance type was not specified and cannot be inferred safely.",
            )
        )

    if rtype == "aws_rds" and not getattr(raw, "instance_class", None):
        unknowns.append(
            UnknownField(
                field="instance_class",
                reason="RDS instance class was not specified.",
            )
        )

    return unknowns


def _build_policy_refs(rtype: str, policy: PolicyConstraints) -> list[str]:
    """Collect policy constraint identifiers that apply to this resource type."""
    refs: list[str] = []
    if policy.allowed_regions:
        refs.append("policy:allowed_regions")
    if policy.required_tags:
        refs.append("policy:required_tags")
    if rtype in policy.prohibited_resource_types:
        # Should not reach here (pre-flight blocks it), but be defensive.
        refs.append("policy:prohibited_resource_types")
    if policy.max_budget is not None:
        refs.append("policy:max_budget")
    return refs


# ---------------------------------------------------------------------------
# Private helpers — source annotation
# ---------------------------------------------------------------------------


def _annotate_region(region: str, policy: PolicyConstraints) -> FieldSource:
    """Annotate the region field with its provenance.

    If the region appears in the policy allowed list it is considered a
    policy-guided choice (confidence 1.0).  Otherwise it is assumed to come
    from the user prompt (confidence 0.95 — valid region, but not policy-pinned).
    """
    if policy.allowed_regions and region in policy.allowed_regions:
        return FieldSource(source="policy_default", confidence=1.0)
    return FieldSource(source="user_prompt", confidence=0.95)
