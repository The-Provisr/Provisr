"""Database planning helper — RDS instance fragments.

Produces a ``CanonicalResource`` of type ``aws_rds`` with:
- Engine (postgres/mysql) and version.
- Instance class and storage.
- Multi-AZ, backup retention, encryption, deletion protection.
- Engine-version assumption when no version is specified.
- Minimum-storage assumption (20 GB).
- Multi-AZ recommendation assumption for production.
"""

from __future__ import annotations

from app.domain.helpers.specs import DatabaseSpec
from app.domain.manifest import (
    CanonicalResource,
    FieldSource,
    ResourceAssumption,
    SecuritySettings,
    UnknownField,
)

# Default engine versions used when the spec omits engine_version.
_DEFAULT_ENGINE_VERSIONS: dict[str, str] = {
    "postgres": "16.3",
    "mysql": "8.0.35",
}


def build_database_fragment(
    spec: DatabaseSpec,
    *,
    tags: dict[str, str] | None = None,
    policy_refs: list[str] | None = None,
) -> CanonicalResource:
    """Build a ``CanonicalResource`` for an RDS database instance.

    Args:
        spec: Validated database specification.
        tags: Tags to attach to the resource.
        policy_refs: Policy constraint IDs that apply to this resource.

    Returns:
        A ``CanonicalResource`` of type ``aws_rds``.
    """
    assumptions: list[ResourceAssumption] = []
    unknowns: list[UnknownField] = []

    # Engine version assumption
    engine_version = spec.engine_version or _DEFAULT_ENGINE_VERSIONS.get(spec.engine, "")
    if not spec.engine_version:
        if engine_version:
            assumptions.append(
                ResourceAssumption(
                    field="engine_version",
                    assumed_value=engine_version,
                    confidence=0.83,
                    reason=(
                        f"Default {spec.engine} version {engine_version} assumed. "
                        "Confirm the version meets your application compatibility requirements."
                    ),
                )
            )
        else:
            unknowns.append(
                UnknownField(
                    field="engine_version",
                    reason=f"No default version is configured for engine '{spec.engine}'.",
                )
            )

    # Minimum storage assumption
    if spec.allocated_storage_gb == 20:
        assumptions.append(
            ResourceAssumption(
                field="allocated_storage_gb",
                assumed_value="20",
                confidence=0.75,
                reason="Minimum storage (20 GB) assumed; confirm if larger data volume is expected.",
            )
        )

    # Multi-AZ recommendation for production-like use (not enforced, just surfaced)
    if not spec.multi_az:
        assumptions.append(
            ResourceAssumption(
                field="multi_az",
                assumed_value="false",
                confidence=0.78,
                reason=(
                    "Single-AZ RDS assumed. For production workloads, enable Multi-AZ "
                    "for automatic failover and higher availability."
                ),
            )
        )

    provider_config: dict[str, object] = {
        "engine": spec.engine,
        "engine_version": engine_version,
        "instance_class": spec.instance_class,
        "allocated_storage_gb": spec.allocated_storage_gb,
        "multi_az": spec.multi_az,
        "backup_retention_days": spec.backup_retention_days,
        "encryption_at_rest": spec.encryption_at_rest,
        "deletion_protection": spec.deletion_protection,
    }

    return CanonicalResource(
        logical_name=spec.logical_name,
        type="aws_rds",
        provider_config=provider_config,
        dependencies=list(spec.dependencies),
        tags=tags or {},
        security_settings=SecuritySettings(
            encryption_enabled=spec.encryption_at_rest,
            public_access=False,
            encryption_type="aws:kms",
        ),
        policy_refs=list(policy_refs or []),
        unknowns=unknowns,
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )
