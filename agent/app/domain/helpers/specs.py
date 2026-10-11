"""Domain-specific planning helper specs.

Each spec is a validated Pydantic model representing the *input* to one
domain helper.  Fields use ``Field(...)`` (required) for values the planner
must supply and provide sensible defaults for values that can be inferred.

Spec models use ``extra="forbid"`` inherited from ``StrictModel`` so stray
keys are caught at construction time, not silently ignored.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.domain.manifest import StrictModel

# ---------------------------------------------------------------------------
# Compute (EC2)
# ---------------------------------------------------------------------------


class ComputeSpec(StrictModel):
    """Specification for an EC2-based compute resource."""

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    instance_type: str = Field(min_length=1, max_length=64)
    # Image alias or AMI ID.  Alias (e.g. "ubuntu-24.04") will be flagged as
    # an assumption; a real AMI ID (starts with "ami-") is taken verbatim.
    image: str = Field(min_length=1, max_length=128)
    count: int = Field(default=1, ge=1, le=20)
    os_family: Literal["linux", "windows"] = "linux"
    # Scaling configuration — None means no auto-scaling group is required.
    min_count: int | None = Field(default=None, ge=1, le=100)
    max_count: int | None = Field(default=None, ge=1, le=100)
    dependencies: list[str] = Field(default_factory=list, max_length=20)


# ---------------------------------------------------------------------------
# Containers (ECS)
# ---------------------------------------------------------------------------


class ContainerPortMapping(StrictModel):
    container_port: int = Field(ge=1, le=65535)
    host_port: int = Field(default=0, ge=0, le=65535)
    protocol: Literal["tcp", "udp"] = "tcp"


class ContainerSpec(StrictModel):
    """Specification for an ECS task definition and service."""

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    image: str = Field(min_length=1, max_length=256)
    cpu: int = Field(default=256, ge=256, le=16384)   # ECS task CPU units
    memory: int = Field(default=512, ge=512, le=122880)  # MiB
    port_mappings: list[ContainerPortMapping] = Field(default_factory=list, max_length=10)
    desired_count: int = Field(default=1, ge=1, le=100)
    launch_type: Literal["FARGATE", "EC2"] = "FARGATE"
    dependencies: list[str] = Field(default_factory=list, max_length=20)


# ---------------------------------------------------------------------------
# Networking (VPC)
# ---------------------------------------------------------------------------


class SecurityGroupRule(StrictModel):
    direction: Literal["ingress", "egress"]
    protocol: Literal["tcp", "udp", "icmp", "-1"] = "tcp"
    from_port: int = Field(ge=-1, le=65535)
    to_port: int = Field(ge=-1, le=65535)
    cidr: str = Field(min_length=9, max_length=18)  # e.g. "0.0.0.0/0"
    description: str = Field(default="", max_length=256)


class NetworkingSpec(StrictModel):
    """Specification for a VPC with public and private subnets."""

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    vpc_cidr: str = Field(default="10.0.0.0/16", min_length=9, max_length=18)
    public_subnet_cidrs: list[str] = Field(
        default_factory=lambda: ["10.0.1.0/24", "10.0.2.0/24"],
        min_length=1,
        max_length=8,
    )
    private_subnet_cidrs: list[str] = Field(
        default_factory=lambda: ["10.0.10.0/24", "10.0.11.0/24"],
        min_length=1,
        max_length=8,
    )
    security_group_rules: list[SecurityGroupRule] = Field(default_factory=list, max_length=20)
    enable_nat_gateway: bool = True
    enable_dns_hostnames: bool = True


# ---------------------------------------------------------------------------
# Database (RDS)
# ---------------------------------------------------------------------------


class DatabaseSpec(StrictModel):
    """Specification for an RDS database instance."""

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    engine: Literal["postgres", "mysql"]
    engine_version: str = Field(default="", max_length=16)
    instance_class: str = Field(min_length=1, max_length=64)
    allocated_storage_gb: int = Field(default=20, ge=20, le=16384)
    multi_az: bool = False
    backup_retention_days: int = Field(default=7, ge=0, le=35)
    encryption_at_rest: bool = True
    deletion_protection: bool = True
    dependencies: list[str] = Field(default_factory=list, max_length=20)


# ---------------------------------------------------------------------------
# Storage (S3)
# ---------------------------------------------------------------------------


class StorageSpec(StrictModel):
    """Specification for an S3 bucket."""

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    # S3 bucket names: 3–63 chars, lowercase, no uppercase or underscores.
    bucket_name: str = Field(
        min_length=3, max_length=63, pattern=r"^[a-z0-9][a-z0-9.-]+[a-z0-9]$"
    )
    versioning_enabled: bool = True
    encryption_at_rest: bool = True
    block_public_access: bool = True
    lifecycle_days_to_ia: int | None = Field(default=None, ge=30)
    lifecycle_days_to_glacier: int | None = Field(default=None, ge=60)


# ---------------------------------------------------------------------------
# Monitoring (CloudWatch)
# ---------------------------------------------------------------------------


class AlarmSpec(StrictModel):
    """A single CloudWatch metric alarm."""

    alarm_name: str = Field(min_length=1, max_length=128)
    metric_name: str = Field(min_length=1, max_length=128)
    namespace: str = Field(min_length=1, max_length=128)
    threshold: float
    comparison_operator: Literal[
        "GreaterThanThreshold",
        "GreaterThanOrEqualToThreshold",
        "LessThanThreshold",
        "LessThanOrEqualToThreshold",
    ] = "GreaterThanThreshold"
    evaluation_periods: int = Field(default=2, ge=1, le=100)
    period_seconds: int = Field(default=300, ge=10, le=86400)
    statistic: Literal["Average", "Sum", "Minimum", "Maximum", "SampleCount"] = "Average"


class MonitoringSpec(StrictModel):
    """Specification for CloudWatch log groups and baseline alarms."""

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    log_group_name: str = Field(min_length=1, max_length=256)
    log_retention_days: int = Field(default=30, ge=1, le=3653)
    alarms: list[AlarmSpec] = Field(default_factory=list, max_length=20)
    dependencies: list[str] = Field(default_factory=list, max_length=20)


# ---------------------------------------------------------------------------
# Load Balancing (ALB)
# ---------------------------------------------------------------------------


class ALBListenerSpec(StrictModel):
    port: int = Field(ge=1, le=65535)
    protocol: Literal["HTTP", "HTTPS"] = "HTTP"
    # ARN of the SSL certificate — required when protocol is HTTPS.
    certificate_arn: str = Field(default="", max_length=2048)


class LoadBalancingSpec(StrictModel):
    """Specification for an Application Load Balancer."""

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    # internal=False means internet-facing (public).
    internal: bool = False
    listeners: list[ALBListenerSpec] = Field(default_factory=list, min_length=1, max_length=5)
    target_port: int = Field(ge=1, le=65535)
    target_protocol: Literal["HTTP", "HTTPS"] = "HTTP"
    health_check_path: str = Field(default="/health", min_length=1, max_length=256)
    deregistration_delay_seconds: int = Field(default=30, ge=0, le=3600)
    dependencies: list[str] = Field(default_factory=list, max_length=20)
