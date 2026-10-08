"""Fragment combiner — assembles domain helper outputs into a CanonicalManifest.

Usage::

    from app.domain.helpers.combiner import combine_fragments
    from app.domain.manifest import ManifestMetadata

    manifest = combine_fragments(
        fragments=[ec2_resource, rds_resource, monitoring_resource],
        provider="aws",
        region="ap-southeast-1",
        environment="production",
        metadata=ManifestMetadata(
            request_id="req-1",
            workspace_id="ws-1",
            user_prompt="Deploy a web app with a database",
        ),
    )

Design rules:
- ``combine_fragments`` is a pure function; it raises ``ValueError`` for
  structural problems (duplicate names, empty list, unknown provider).
- Tags passed to ``combine_fragments`` are merged into every fragment's tags
  (fragment-level tags are not overwritten, they take precedence).
- The caller is responsible for ordering fragments; the combiner preserves order.
"""

from __future__ import annotations

from typing import Literal

from app.domain.manifest import (
    CanonicalManifest,
    CanonicalResource,
    FieldSource,
    ManifestMetadata,
)


def combine_fragments(
    fragments: list[CanonicalResource],
    *,
    provider: Literal["aws"] = "aws",
    region: str,
    environment: Literal["development", "staging", "production", "sandbox"],
    metadata: ManifestMetadata,
    tags: dict[str, str] | None = None,
    cloud_account: str = "",
    monthly_budget_usd: float | None = None,
    region_source: FieldSource | None = None,
) -> CanonicalManifest:
    """Assemble a list of ``CanonicalResource`` fragments into a ``CanonicalManifest``.

    Args:
        fragments: Non-empty list of resources produced by domain helpers.
        provider: Cloud provider (currently only "aws").
        region: Deployment region (e.g. "ap-southeast-1").
        environment: Deployment environment.
        metadata: Trace context (request_id, workspace_id, user_prompt).
        tags: Manifest-level tags merged into each fragment (fragment tags win).
        cloud_account: Optional cloud account ID or alias.
        monthly_budget_usd: Optional budget cap for cost validation.
        region_source: Optional provenance annotation for the region field.

    Returns:
        A validated ``CanonicalManifest``.

    Raises:
        ValueError: If ``fragments`` is empty or contains duplicate logical names.
    """
    if not fragments:
        raise ValueError("combine_fragments requires at least one fragment")

    # Detect duplicate logical names early — they would produce invalid Terraform.
    _check_duplicate_names(fragments)

    manifest_tags = tags or {}

    # Merge manifest-level tags into each fragment (fragment tags take precedence).
    enriched = [_merge_tags(fragment, manifest_tags) for fragment in fragments]

    return CanonicalManifest(
        provider=provider,
        region=region,
        cloud_account=cloud_account,
        environment=environment,
        metadata=metadata,
        tags=manifest_tags,
        monthly_budget_usd=monthly_budget_usd,
        resources=enriched,
        region_source=region_source or FieldSource(source="user_prompt", confidence=1.0),
        environment_source=FieldSource(source="user_prompt", confidence=1.0),
        provider_source=FieldSource(source="user_prompt", confidence=1.0),
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _check_duplicate_names(fragments: list[CanonicalResource]) -> None:
    seen: set[str] = set()
    for fragment in fragments:
        if fragment.logical_name in seen:
            raise ValueError(
                f"Duplicate logical_name '{fragment.logical_name}' in fragment list. "
                "Each resource must have a unique name within the manifest."
            )
        seen.add(fragment.logical_name)


def _merge_tags(
    fragment: CanonicalResource,
    manifest_tags: dict[str, str],
) -> CanonicalResource:
    """Return a copy of fragment with manifest_tags merged in (fragment tags win)."""
    if not manifest_tags:
        return fragment
    merged = {**manifest_tags, **fragment.tags}
    if merged == fragment.tags:
        return fragment  # nothing changed — avoid unnecessary copy
    return fragment.model_copy(update={"tags": merged})
