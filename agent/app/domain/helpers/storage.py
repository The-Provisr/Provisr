"""Storage planning helper — S3 bucket fragments.

Produces a ``CanonicalResource`` of type ``aws_s3`` with:
- Versioning, encryption at rest, public-access block.
- Optional lifecycle rules (IA transition, Glacier transition).
- An assumption when public-access block is disabled.
"""

from __future__ import annotations

from app.domain.helpers.specs import StorageSpec
from app.domain.manifest import (
    CanonicalResource,
    FieldSource,
    ResourceAssumption,
    SecuritySettings,
)


def build_storage_fragment(
    spec: StorageSpec,
    *,
    tags: dict[str, str] | None = None,
    policy_refs: list[str] | None = None,
) -> CanonicalResource:
    """Build a ``CanonicalResource`` for an S3 bucket.

    Args:
        spec: Validated storage specification.
        tags: Tags to attach to the resource.
        policy_refs: Policy constraint IDs that apply to this resource.

    Returns:
        A ``CanonicalResource`` of type ``aws_s3``.
    """
    assumptions: list[ResourceAssumption] = []

    # Public-access assumption
    if not spec.block_public_access:
        assumptions.append(
            ResourceAssumption(
                field="block_public_access",
                assumed_value="false",
                confidence=0.60,
                reason=(
                    "Public access block is disabled. This exposes the bucket to the internet. "
                    "Only disable if a public-facing static site or download bucket is intended."
                ),
            )
        )

    # Versioning off assumption
    if not spec.versioning_enabled:
        assumptions.append(
            ResourceAssumption(
                field="versioning_enabled",
                assumed_value="false",
                confidence=0.72,
                reason=(
                    "Versioning is disabled. Enable versioning to protect against accidental "
                    "deletions and enable point-in-time recovery."
                ),
            )
        )

    # Build lifecycle config
    lifecycle: dict[str, object] = {}
    if spec.lifecycle_days_to_ia is not None:
        lifecycle["transition_to_ia_days"] = spec.lifecycle_days_to_ia
    if spec.lifecycle_days_to_glacier is not None:
        lifecycle["transition_to_glacier_days"] = spec.lifecycle_days_to_glacier

    provider_config: dict[str, object] = {
        "bucket_name": spec.bucket_name,
        "versioning_enabled": spec.versioning_enabled,
        "encryption_at_rest": spec.encryption_at_rest,
        "block_public_access": spec.block_public_access,
    }
    if lifecycle:
        provider_config["lifecycle"] = lifecycle

    return CanonicalResource(
        logical_name=spec.logical_name,
        type="aws_s3",
        provider_config=provider_config,
        tags=tags or {},
        security_settings=SecuritySettings(
            encryption_enabled=spec.encryption_at_rest,
            public_access=not spec.block_public_access,
            encryption_type="AES256",
        ),
        policy_refs=list(policy_refs or []),
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )
