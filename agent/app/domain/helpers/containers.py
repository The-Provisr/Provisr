"""Containers planning helper — ECS task definition fragments.

Produces a ``CanonicalResource`` of type ``aws_ecs_service`` with:
- Container image, CPU/memory (Fargate or EC2 launch type).
- Port mappings (container → host).
- Desired task count.
- Assumptions for default CPU/memory and single-task deployments.
"""

from __future__ import annotations

from app.domain.helpers.specs import ContainerSpec
from app.domain.manifest import (
    CanonicalResource,
    FieldSource,
    ResourceAssumption,
    SecuritySettings,
)

# Fargate valid CPU/memory combinations (cpu_units: [valid_memory_mib, ...])
_FARGATE_VALID_MEMORY: dict[int, list[int]] = {
    256:  [512, 1024, 2048],
    512:  [1024, 2048, 3072, 4096],
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
    2048: list(range(4096, 16385, 1024)),
    4096: list(range(8192, 30721, 1024)),
}


def build_container_fragment(
    spec: ContainerSpec,
    *,
    tags: dict[str, str] | None = None,
    policy_refs: list[str] | None = None,
) -> CanonicalResource:
    """Build a ``CanonicalResource`` for an ECS task/service workload.

    Args:
        spec: Validated container specification.
        tags: Tags to attach to the resource.
        policy_refs: Policy constraint IDs that apply to this resource.

    Returns:
        A ``CanonicalResource`` of type ``aws_ecs_service``.
    """
    assumptions: list[ResourceAssumption] = []

    # Fargate CPU/memory compatibility check
    if spec.launch_type == "FARGATE":
        valid_mem = _FARGATE_VALID_MEMORY.get(spec.cpu)
        if valid_mem and spec.memory not in valid_mem:
            assumptions.append(
                ResourceAssumption(
                    field="memory",
                    assumed_value=str(spec.memory),
                    confidence=0.70,
                    reason=(
                        f"Memory {spec.memory} MiB may not be valid for Fargate CPU {spec.cpu}. "
                        f"Valid values: {valid_mem}."
                    ),
                )
            )

    # Single-task assumption
    if spec.desired_count == 1:
        assumptions.append(
            ResourceAssumption(
                field="desired_count",
                assumed_value="1",
                confidence=0.78,
                reason="Single task assumed; confirm if redundancy is required.",
            )
        )

    port_mappings_config = [
        {
            "container_port": pm.container_port,
            "host_port": pm.host_port,
            "protocol": pm.protocol,
        }
        for pm in spec.port_mappings
    ]

    provider_config: dict[str, object] = {
        "image": spec.image,
        "cpu": spec.cpu,
        "memory": spec.memory,
        "desired_count": spec.desired_count,
        "launch_type": spec.launch_type,
        "port_mappings": port_mappings_config,
    }

    return CanonicalResource(
        logical_name=spec.logical_name,
        type="aws_ecs_service",
        provider_config=provider_config,
        dependencies=list(spec.dependencies),
        tags=tags or {},
        security_settings=SecuritySettings(encryption_enabled=True, public_access=False),
        policy_refs=list(policy_refs or []),
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )
