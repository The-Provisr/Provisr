"""Networking planning helper — VPC / subnet fragments.

Produces a ``CanonicalResource`` of type ``aws_vpc`` with:
- VPC CIDR block.
- Public and private subnet CIDRs.
- Security group rules (ingress/egress).
- NAT gateway and DNS hostname flags.
- Assumptions for default CIDR ranges and NAT gateway cost.
"""

from __future__ import annotations

from app.domain.helpers.specs import NetworkingSpec
from app.domain.manifest import (
    CanonicalResource,
    FieldSource,
    ResourceAssumption,
    SecuritySettings,
)

_DEFAULT_VPC_CIDR = "10.0.0.0/16"


def build_networking_fragment(
    spec: NetworkingSpec,
    *,
    tags: dict[str, str] | None = None,
    policy_refs: list[str] | None = None,
) -> CanonicalResource:
    """Build a ``CanonicalResource`` for a VPC networking setup.

    Args:
        spec: Validated networking specification.
        tags: Tags to attach to the resource.
        policy_refs: Policy constraint IDs that apply to this resource.

    Returns:
        A ``CanonicalResource`` of type ``aws_vpc``.
    """
    assumptions: list[ResourceAssumption] = []

    # Default CIDR assumption
    if spec.vpc_cidr == _DEFAULT_VPC_CIDR:
        assumptions.append(
            ResourceAssumption(
                field="vpc_cidr",
                assumed_value=_DEFAULT_VPC_CIDR,
                confidence=0.82,
                reason=(
                    "Default VPC CIDR 10.0.0.0/16 assumed. "
                    "Confirm it does not conflict with existing VPCs or on-premises networks."
                ),
            )
        )

    # NAT gateway cost assumption
    if spec.enable_nat_gateway:
        assumptions.append(
            ResourceAssumption(
                field="enable_nat_gateway",
                assumed_value="true",
                confidence=0.88,
                reason=(
                    "NAT gateway enabled for private subnet internet access. "
                    "This incurs hourly and data-processing charges (~$32/mo per AZ). "
                    "Disable if private subnets do not need outbound internet access."
                ),
            )
        )

    security_group_rules_config = [
        {
            "direction": rule.direction,
            "protocol": rule.protocol,
            "from_port": rule.from_port,
            "to_port": rule.to_port,
            "cidr": rule.cidr,
            "description": rule.description,
        }
        for rule in spec.security_group_rules
    ]

    provider_config: dict[str, object] = {
        "vpc_cidr": spec.vpc_cidr,
        "public_subnet_cidrs": list(spec.public_subnet_cidrs),
        "private_subnet_cidrs": list(spec.private_subnet_cidrs),
        "enable_nat_gateway": spec.enable_nat_gateway,
        "enable_dns_hostnames": spec.enable_dns_hostnames,
        "security_group_rules": security_group_rules_config,
    }

    return CanonicalResource(
        logical_name=spec.logical_name,
        type="aws_vpc",
        provider_config=provider_config,
        tags=tags or {},
        security_settings=SecuritySettings(encryption_enabled=False, public_access=False),
        policy_refs=list(policy_refs or []),
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )
