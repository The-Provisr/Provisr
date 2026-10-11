"""Load balancing planning helper — ALB fragments.

Produces a ``CanonicalResource`` of type ``aws_alb`` with:
- Internet-facing or internal scheme.
- Listener configuration (HTTP/HTTPS with optional certificate ARN).
- Target group protocol, port, and health-check path.
- Assumption when HTTPS listener has no certificate ARN.
- Assumption when the ALB is internet-facing.
"""

from __future__ import annotations

from app.domain.helpers.specs import LoadBalancingSpec
from app.domain.manifest import (
    CanonicalResource,
    FieldSource,
    ResourceAssumption,
    SecuritySettings,
    UnknownField,
)


def build_load_balancing_fragment(
    spec: LoadBalancingSpec,
    *,
    tags: dict[str, str] | None = None,
    policy_refs: list[str] | None = None,
) -> CanonicalResource:
    """Build a ``CanonicalResource`` for an Application Load Balancer.

    Args:
        spec: Validated load balancing specification.
        tags: Tags to attach to the resource.
        policy_refs: Policy constraint IDs that apply to this resource.

    Returns:
        A ``CanonicalResource`` of type ``aws_alb``.
    """
    assumptions: list[ResourceAssumption] = []
    unknowns: list[UnknownField] = []

    # Internet-facing exposure assumption
    if not spec.internal:
        assumptions.append(
            ResourceAssumption(
                field="internal",
                assumed_value="false",
                confidence=0.88,
                reason=(
                    "ALB is internet-facing (public). Security group rules must restrict "
                    "access to intended source CIDRs. Confirm public exposure is intended."
                ),
            )
        )

    # Validate HTTPS listeners have a certificate ARN
    listeners_config: list[dict[str, object]] = []
    for listener in spec.listeners:
        if listener.protocol == "HTTPS" and not listener.certificate_arn:
            unknowns.append(
                UnknownField(
                    field="certificate_arn",
                    reason=(
                        f"HTTPS listener on port {listener.port} requires a certificate ARN "
                        "(ACM or IAM). Provide a valid certificate ARN before deployment."
                    ),
                )
            )
        listeners_config.append(
            {
                "port": listener.port,
                "protocol": listener.protocol,
                "certificate_arn": listener.certificate_arn,
            }
        )

    provider_config: dict[str, object] = {
        "internal": spec.internal,
        "scheme": "internal" if spec.internal else "internet-facing",
        "listeners": listeners_config,
        "target_port": spec.target_port,
        "target_protocol": spec.target_protocol,
        "health_check_path": spec.health_check_path,
        "deregistration_delay_seconds": spec.deregistration_delay_seconds,
    }

    return CanonicalResource(
        logical_name=spec.logical_name,
        type="aws_alb",
        provider_config=provider_config,
        dependencies=list(spec.dependencies),
        tags=tags or {},
        security_settings=SecuritySettings(
            encryption_enabled=True,
            public_access=not spec.internal,
        ),
        policy_refs=list(policy_refs or []),
        unknowns=unknowns,
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )
