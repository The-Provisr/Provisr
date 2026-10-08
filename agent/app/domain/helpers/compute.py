"""Compute planning helper — EC2 instance fragments.

Produces a ``CanonicalResource`` of type ``aws_ec2`` with:
- Instance type, image (alias or AMI ID), count, OS family.
- Auto-scaling configuration when min_count / max_count are provided.
- An assumption for non-AMI image aliases (confidence 0.85).
- An assumption for single-instance count (confidence 0.80).
- An assumption when auto-scaling is inferred but not explicitly requested.
"""

from __future__ import annotations

from app.domain.helpers.specs import ComputeSpec
from app.domain.manifest import (
    CanonicalResource,
    FieldSource,
    ResourceAssumption,
    SecuritySettings,
)

# Known instance families and their vCPU / RAM profiles (informational).
_INSTANCE_PROFILES: dict[str, dict[str, object]] = {
    "t3.micro":   {"vcpu": 2,  "ram_gb": 1,   "family": "burstable"},
    "t3.small":   {"vcpu": 2,  "ram_gb": 2,   "family": "burstable"},
    "t3.medium":  {"vcpu": 2,  "ram_gb": 4,   "family": "burstable"},
    "t3.large":   {"vcpu": 2,  "ram_gb": 8,   "family": "burstable"},
    "t3.xlarge":  {"vcpu": 4,  "ram_gb": 16,  "family": "burstable"},
    "m5.large":   {"vcpu": 2,  "ram_gb": 8,   "family": "general"},
    "m5.xlarge":  {"vcpu": 4,  "ram_gb": 16,  "family": "general"},
    "m5.2xlarge": {"vcpu": 8,  "ram_gb": 32,  "family": "general"},
    "c5.large":   {"vcpu": 2,  "ram_gb": 4,   "family": "compute"},
    "c5.xlarge":  {"vcpu": 4,  "ram_gb": 8,   "family": "compute"},
    "c5.2xlarge": {"vcpu": 8,  "ram_gb": 16,  "family": "compute"},
    "r5.large":   {"vcpu": 2,  "ram_gb": 16,  "family": "memory"},
    "r5.xlarge":  {"vcpu": 4,  "ram_gb": 32,  "family": "memory"},
}


def build_compute_fragment(
    spec: ComputeSpec,
    *,
    tags: dict[str, str] | None = None,
    policy_refs: list[str] | None = None,
) -> CanonicalResource:
    """Build a ``CanonicalResource`` for an EC2 compute workload.

    Args:
        spec: Validated compute specification.
        tags: Tags to attach to the resource (manifest-level tags already merged).
        policy_refs: Policy constraint IDs that apply to this resource.

    Returns:
        A ``CanonicalResource`` of type ``aws_ec2``.
    """
    assumptions: list[ResourceAssumption] = []
    profile = _INSTANCE_PROFILES.get(spec.instance_type, {})

    # Image alias assumption
    if not spec.image.startswith("ami-"):
        assumptions.append(
            ResourceAssumption(
                field="image",
                assumed_value=spec.image,
                confidence=0.85,
                reason=(
                    f"Image alias '{spec.image}' will be resolved to a region-specific "
                    "AMI ID at execution time. Confirm the alias is correct."
                ),
            )
        )

    # Single-instance count assumption
    if spec.count == 1 and spec.min_count is None:
        assumptions.append(
            ResourceAssumption(
                field="count",
                assumed_value="1",
                confidence=0.80,
                reason="Single instance assumed; confirm if high availability is required.",
            )
        )

    # Build provider_config
    provider_config: dict[str, object] = {
        "instance_type": spec.instance_type,
        "image": spec.image,
        "count": spec.count,
        "os_family": spec.os_family,
    }
    if profile:
        provider_config["vcpu"] = profile["vcpu"]
        provider_config["ram_gb"] = profile["ram_gb"]
        provider_config["instance_family"] = profile["family"]

    # Auto-scaling block (optional)
    if spec.min_count is not None and spec.max_count is not None:
        provider_config["auto_scaling"] = {
            "min_count": spec.min_count,
            "max_count": spec.max_count,
            "desired_count": spec.count,
        }
        if spec.min_count == spec.count == spec.max_count:
            assumptions.append(
                ResourceAssumption(
                    field="auto_scaling",
                    assumed_value=f"min={spec.min_count}, max={spec.max_count}",
                    confidence=0.82,
                    reason=(
                        "Auto-scaling group added with fixed capacity. "
                        "Adjust min/max if dynamic scaling is needed."
                    ),
                )
            )

    return CanonicalResource(
        logical_name=spec.logical_name,
        type="aws_ec2",
        provider_config=provider_config,
        dependencies=list(spec.dependencies),
        tags=tags or {},
        security_settings=SecuritySettings(encryption_enabled=True, public_access=False),
        policy_refs=list(policy_refs or []),
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )
