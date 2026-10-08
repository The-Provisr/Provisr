"""Tests for all domain planning helpers and the fragment combiner.

Each helper is tested for:
- Correct resource type on the output fragment.
- Provider config fields are populated correctly.
- Assumptions are generated for known inferred values.
- Security settings reflect the spec.
- Edge cases (missing optional fields, disabled flags, etc.).

The combiner is tested for:
- Tag merge semantics (fragment tags win).
- Duplicate name detection.
- Empty fragment list rejection.
- Full manifest structure validity.
"""

from __future__ import annotations

import pytest

from app.domain.helpers import (
    compute,
    containers,
    database,
    load_balancing,
    monitoring,
    networking,
    storage,
)
from app.domain.helpers.combiner import combine_fragments
from app.domain.helpers.specs import (
    AlarmSpec,
    ALBListenerSpec,
    ComputeSpec,
    ContainerPortMapping,
    ContainerSpec,
    DatabaseSpec,
    LoadBalancingSpec,
    MonitoringSpec,
    NetworkingSpec,
    SecurityGroupRule,
    StorageSpec,
)
from app.domain.manifest import CanonicalResource, FieldSource, ManifestMetadata

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _meta() -> ManifestMetadata:
    return ManifestMetadata(
        request_id="req-1",
        workspace_id="ws-1",
        user_prompt="Deploy infra",
    )


# ===========================================================================
# Compute helper
# ===========================================================================


class TestComputeHelper:
    def _spec(self, **kwargs: object) -> ComputeSpec:
        defaults = {
            "logical_name": "api-server",
            "instance_type": "t3.medium",
            "image": "ubuntu-24.04",
        }
        defaults.update(kwargs)
        return ComputeSpec(**defaults)  # type: ignore[arg-type]

    def test_returns_aws_ec2_resource(self) -> None:
        r = compute.build_compute_fragment(self._spec())
        assert r.type == "aws_ec2"

    def test_logical_name_preserved(self) -> None:
        r = compute.build_compute_fragment(self._spec(logical_name="web"))
        assert r.logical_name == "web"

    def test_instance_type_in_provider_config(self) -> None:
        r = compute.build_compute_fragment(self._spec(instance_type="m5.large"))
        assert r.provider_config["instance_type"] == "m5.large"

    def test_known_instance_type_injects_vcpu_and_ram(self) -> None:
        r = compute.build_compute_fragment(self._spec(instance_type="t3.medium"))
        assert r.provider_config["vcpu"] == 2
        assert r.provider_config["ram_gb"] == 4

    def test_unknown_instance_type_omits_vcpu_ram(self) -> None:
        r = compute.build_compute_fragment(self._spec(instance_type="x99.custom"))
        assert "vcpu" not in r.provider_config

    def test_image_alias_generates_assumption(self) -> None:
        r = compute.build_compute_fragment(self._spec(image="ubuntu-24.04"))
        image_assumptions = [a for a in r.assumptions if a.field == "image"]
        assert image_assumptions
        assert image_assumptions[0].confidence < 0.9

    def test_real_ami_id_no_image_assumption(self) -> None:
        r = compute.build_compute_fragment(self._spec(image="ami-0abcdef1234567890"))
        image_assumptions = [a for a in r.assumptions if a.field == "image"]
        assert not image_assumptions

    def test_single_count_generates_assumption(self) -> None:
        r = compute.build_compute_fragment(self._spec(count=1))
        count_assumptions = [a for a in r.assumptions if a.field == "count"]
        assert count_assumptions

    def test_multi_count_no_count_assumption(self) -> None:
        r = compute.build_compute_fragment(self._spec(count=3))
        count_assumptions = [a for a in r.assumptions if a.field == "count"]
        assert not count_assumptions

    def test_auto_scaling_block_added_when_min_max_set(self) -> None:
        r = compute.build_compute_fragment(self._spec(count=2, min_count=1, max_count=5))
        assert "auto_scaling" in r.provider_config
        asg = r.provider_config["auto_scaling"]
        assert isinstance(asg, dict)
        assert asg["min_count"] == 1
        assert asg["max_count"] == 5

    def test_no_auto_scaling_block_when_min_max_absent(self) -> None:
        r = compute.build_compute_fragment(self._spec())
        assert "auto_scaling" not in r.provider_config

    def test_tags_attached(self) -> None:
        r = compute.build_compute_fragment(self._spec(), tags={"env": "prod"})
        assert r.tags["env"] == "prod"

    def test_policy_refs_attached(self) -> None:
        r = compute.build_compute_fragment(self._spec(), policy_refs=["policy:allowed_regions"])
        assert "policy:allowed_regions" in r.policy_refs

    def test_encryption_enabled_by_default(self) -> None:
        r = compute.build_compute_fragment(self._spec())
        assert r.security_settings.encryption_enabled is True

    def test_public_access_disabled_by_default(self) -> None:
        r = compute.build_compute_fragment(self._spec())
        assert r.security_settings.public_access is False

    def test_dependencies_forwarded(self) -> None:
        r = compute.build_compute_fragment(self._spec(dependencies=["vpc-1"]))
        assert "vpc-1" in r.dependencies


# ===========================================================================
# Containers helper
# ===========================================================================


class TestContainersHelper:
    def _spec(self, **kwargs: object) -> ContainerSpec:
        defaults = {"logical_name": "api-task", "image": "nginx:1.25"}
        defaults.update(kwargs)
        return ContainerSpec(**defaults)  # type: ignore[arg-type]

    def test_returns_aws_ecs_service(self) -> None:
        r = containers.build_container_fragment(self._spec())
        assert r.type == "aws_ecs_service"

    def test_image_in_provider_config(self) -> None:
        r = containers.build_container_fragment(self._spec(image="my-app:latest"))
        assert r.provider_config["image"] == "my-app:latest"

    def test_cpu_memory_in_provider_config(self) -> None:
        r = containers.build_container_fragment(self._spec(cpu=512, memory=1024))
        assert r.provider_config["cpu"] == 512
        assert r.provider_config["memory"] == 1024

    def test_single_task_count_generates_assumption(self) -> None:
        r = containers.build_container_fragment(self._spec(desired_count=1))
        count_assumptions = [a for a in r.assumptions if a.field == "desired_count"]
        assert count_assumptions

    def test_multi_task_no_count_assumption(self) -> None:
        r = containers.build_container_fragment(self._spec(desired_count=3))
        count_assumptions = [a for a in r.assumptions if a.field == "desired_count"]
        assert not count_assumptions

    def test_invalid_fargate_memory_generates_assumption(self) -> None:
        # 256 CPU only allows 512, 1024, 2048 MiB — 999 is invalid
        r = containers.build_container_fragment(self._spec(cpu=256, memory=999))
        mem_assumptions = [a for a in r.assumptions if a.field == "memory"]
        assert mem_assumptions

    def test_valid_fargate_memory_no_assumption(self) -> None:
        r = containers.build_container_fragment(self._spec(cpu=256, memory=512))
        mem_assumptions = [a for a in r.assumptions if a.field == "memory"]
        assert not mem_assumptions

    def test_port_mappings_serialized(self) -> None:
        spec = self._spec(
            port_mappings=[ContainerPortMapping(container_port=8080, host_port=0)]
        )
        r = containers.build_container_fragment(spec)
        ports = r.provider_config["port_mappings"]
        assert isinstance(ports, list)
        assert ports[0]["container_port"] == 8080

    def test_launch_type_preserved(self) -> None:
        r = containers.build_container_fragment(self._spec(launch_type="EC2"))
        assert r.provider_config["launch_type"] == "EC2"


# ===========================================================================
# Networking helper
# ===========================================================================


class TestNetworkingHelper:
    def _spec(self, **kwargs: object) -> NetworkingSpec:
        defaults = {"logical_name": "main-vpc"}
        defaults.update(kwargs)
        return NetworkingSpec(**defaults)  # type: ignore[arg-type]

    def test_returns_aws_vpc(self) -> None:
        r = networking.build_networking_fragment(self._spec())
        assert r.type == "aws_vpc"

    def test_vpc_cidr_in_provider_config(self) -> None:
        r = networking.build_networking_fragment(self._spec(vpc_cidr="10.1.0.0/16"))
        assert r.provider_config["vpc_cidr"] == "10.1.0.0/16"

    def test_default_cidr_generates_assumption(self) -> None:
        r = networking.build_networking_fragment(self._spec())  # default CIDR
        cidr_assumptions = [a for a in r.assumptions if a.field == "vpc_cidr"]
        assert cidr_assumptions

    def test_nat_gateway_enabled_generates_assumption(self) -> None:
        r = networking.build_networking_fragment(self._spec(enable_nat_gateway=True))
        nat_assumptions = [a for a in r.assumptions if a.field == "enable_nat_gateway"]
        assert nat_assumptions

    def test_nat_gateway_disabled_no_assumption(self) -> None:
        r = networking.build_networking_fragment(self._spec(enable_nat_gateway=False))
        nat_assumptions = [a for a in r.assumptions if a.field == "enable_nat_gateway"]
        assert not nat_assumptions

    def test_public_and_private_subnets_in_config(self) -> None:
        r = networking.build_networking_fragment(self._spec())
        assert isinstance(r.provider_config["public_subnet_cidrs"], list)
        assert isinstance(r.provider_config["private_subnet_cidrs"], list)
        assert len(r.provider_config["public_subnet_cidrs"]) >= 1  # type: ignore[arg-type]

    def test_security_group_rules_serialized(self) -> None:
        spec = self._spec(
            security_group_rules=[
                SecurityGroupRule(
                    direction="ingress",
                    protocol="tcp",
                    from_port=443,
                    to_port=443,
                    cidr="0.0.0.0/0",
                    description="HTTPS",
                )
            ]
        )
        r = networking.build_networking_fragment(spec)
        rules = r.provider_config["security_group_rules"]
        assert isinstance(rules, list)
        assert rules[0]["from_port"] == 443

    def test_public_access_false(self) -> None:
        r = networking.build_networking_fragment(self._spec())
        assert r.security_settings.public_access is False


# ===========================================================================
# Database helper
# ===========================================================================


class TestDatabaseHelper:
    def _spec(self, **kwargs: object) -> DatabaseSpec:
        defaults = {
            "logical_name": "main-db",
            "engine": "postgres",
            "instance_class": "db.t3.micro",
        }
        defaults.update(kwargs)
        return DatabaseSpec(**defaults)  # type: ignore[arg-type]

    def test_returns_aws_rds(self) -> None:
        r = database.build_database_fragment(self._spec())
        assert r.type == "aws_rds"

    def test_engine_in_provider_config(self) -> None:
        r = database.build_database_fragment(self._spec(engine="mysql"))
        assert r.provider_config["engine"] == "mysql"

    def test_default_engine_version_assumed_postgres(self) -> None:
        r = database.build_database_fragment(self._spec())
        version_assumptions = [a for a in r.assumptions if a.field == "engine_version"]
        assert version_assumptions
        assert "16" in version_assumptions[0].assumed_value

    def test_default_engine_version_assumed_mysql(self) -> None:
        r = database.build_database_fragment(self._spec(engine="mysql"))
        version_assumptions = [a for a in r.assumptions if a.field == "engine_version"]
        assert version_assumptions
        assert "8.0" in version_assumptions[0].assumed_value

    def test_explicit_engine_version_no_assumption(self) -> None:
        r = database.build_database_fragment(self._spec(engine_version="15.3"))
        version_assumptions = [a for a in r.assumptions if a.field == "engine_version"]
        assert not version_assumptions

    def test_minimum_storage_assumption(self) -> None:
        r = database.build_database_fragment(self._spec(allocated_storage_gb=20))
        storage_assumptions = [a for a in r.assumptions if a.field == "allocated_storage_gb"]
        assert storage_assumptions

    def test_larger_storage_no_assumption(self) -> None:
        r = database.build_database_fragment(self._spec(allocated_storage_gb=100))
        storage_assumptions = [a for a in r.assumptions if a.field == "allocated_storage_gb"]
        assert not storage_assumptions

    def test_single_az_generates_assumption(self) -> None:
        r = database.build_database_fragment(self._spec(multi_az=False))
        az_assumptions = [a for a in r.assumptions if a.field == "multi_az"]
        assert az_assumptions

    def test_multi_az_no_assumption(self) -> None:
        r = database.build_database_fragment(self._spec(multi_az=True))
        az_assumptions = [a for a in r.assumptions if a.field == "multi_az"]
        assert not az_assumptions

    def test_encryption_at_rest_reflected_in_security_settings(self) -> None:
        r = database.build_database_fragment(self._spec(encryption_at_rest=True))
        assert r.security_settings.encryption_enabled is True

    def test_public_access_always_false(self) -> None:
        r = database.build_database_fragment(self._spec())
        assert r.security_settings.public_access is False

    def test_backup_retention_in_provider_config(self) -> None:
        r = database.build_database_fragment(self._spec(backup_retention_days=14))
        assert r.provider_config["backup_retention_days"] == 14

    def test_deletion_protection_in_provider_config(self) -> None:
        r = database.build_database_fragment(self._spec(deletion_protection=True))
        assert r.provider_config["deletion_protection"] is True


# ===========================================================================
# Storage helper
# ===========================================================================


class TestStorageHelper:
    def _spec(self, **kwargs: object) -> StorageSpec:
        defaults = {"logical_name": "assets", "bucket_name": "my-test-bucket"}
        defaults.update(kwargs)
        return StorageSpec(**defaults)  # type: ignore[arg-type]

    def test_returns_aws_s3(self) -> None:
        r = storage.build_storage_fragment(self._spec())
        assert r.type == "aws_s3"

    def test_bucket_name_in_provider_config(self) -> None:
        r = storage.build_storage_fragment(self._spec(bucket_name="my-test-bucket"))
        assert r.provider_config["bucket_name"] == "my-test-bucket"

    def test_versioning_in_provider_config(self) -> None:
        r = storage.build_storage_fragment(self._spec(versioning_enabled=True))
        assert r.provider_config["versioning_enabled"] is True

    def test_public_access_disabled_no_assumption(self) -> None:
        r = storage.build_storage_fragment(self._spec(block_public_access=True))
        public_assumptions = [a for a in r.assumptions if a.field == "block_public_access"]
        assert not public_assumptions

    def test_public_access_enabled_generates_assumption(self) -> None:
        r = storage.build_storage_fragment(self._spec(block_public_access=False))
        public_assumptions = [a for a in r.assumptions if a.field == "block_public_access"]
        assert public_assumptions
        assert public_assumptions[0].confidence < 0.7

    def test_versioning_disabled_generates_assumption(self) -> None:
        r = storage.build_storage_fragment(self._spec(versioning_enabled=False))
        ver_assumptions = [a for a in r.assumptions if a.field == "versioning_enabled"]
        assert ver_assumptions

    def test_lifecycle_added_when_days_set(self) -> None:
        r = storage.build_storage_fragment(
            self._spec(lifecycle_days_to_ia=30, lifecycle_days_to_glacier=90)
        )
        lifecycle = r.provider_config.get("lifecycle")
        assert lifecycle is not None
        lc = lifecycle
        assert isinstance(lc, dict)
        assert lc["transition_to_ia_days"] == 30
        assert lc["transition_to_glacier_days"] == 90

    def test_no_lifecycle_key_when_not_set(self) -> None:
        r = storage.build_storage_fragment(self._spec())
        assert "lifecycle" not in r.provider_config

    def test_encryption_in_security_settings(self) -> None:
        r = storage.build_storage_fragment(self._spec(encryption_at_rest=True))
        assert r.security_settings.encryption_enabled is True

    def test_public_access_reflected_in_security_settings(self) -> None:
        r = storage.build_storage_fragment(self._spec(block_public_access=False))
        assert r.security_settings.public_access is True


# ===========================================================================
# Monitoring helper
# ===========================================================================


class TestMonitoringHelper:
    def _spec(self, **kwargs: object) -> MonitoringSpec:
        defaults = {"logical_name": "app-monitoring", "log_group_name": "/app/logs"}
        defaults.update(kwargs)
        return MonitoringSpec(**defaults)  # type: ignore[arg-type]

    def test_returns_aws_cloudwatch(self) -> None:
        r = monitoring.build_monitoring_fragment(self._spec())
        assert r.type == "aws_cloudwatch"

    def test_log_group_name_in_provider_config(self) -> None:
        r = monitoring.build_monitoring_fragment(self._spec(log_group_name="/my/logs"))
        assert r.provider_config["log_group_name"] == "/my/logs"

    def test_log_retention_in_provider_config(self) -> None:
        r = monitoring.build_monitoring_fragment(self._spec(log_retention_days=14))
        assert r.provider_config["log_retention_days"] == 14

    def test_no_alarms_generates_baseline_assumption(self) -> None:
        r = monitoring.build_monitoring_fragment(self._spec())
        alarm_assumptions = [a for a in r.assumptions if a.field == "alarms"]
        assert alarm_assumptions
        assert "baseline" in alarm_assumptions[0].assumed_value

    def test_no_alarms_adds_default_alarms(self) -> None:
        r = monitoring.build_monitoring_fragment(self._spec())
        alarms = r.provider_config.get("alarms")
        assert isinstance(alarms, list)
        assert len(alarms) > 0

    def test_explicit_alarms_used_verbatim(self) -> None:
        custom_alarm = AlarmSpec(
            alarm_name="custom-alarm",
            metric_name="RequestCount",
            namespace="AWS/ApplicationELB",
            threshold=1000.0,
        )
        r = monitoring.build_monitoring_fragment(self._spec(alarms=[custom_alarm]))
        alarms = r.provider_config["alarms"]
        assert isinstance(alarms, list)
        assert alarms[0]["alarm_name"] == "custom-alarm"

    def test_explicit_alarms_no_baseline_assumption(self) -> None:
        custom_alarm = AlarmSpec(
            alarm_name="my-alarm",
            metric_name="Errors",
            namespace="AWS/Lambda",
            threshold=5.0,
        )
        r = monitoring.build_monitoring_fragment(self._spec(alarms=[custom_alarm]))
        alarm_assumptions = [a for a in r.assumptions if a.field == "alarms"]
        assert not alarm_assumptions

    def test_dependencies_forwarded(self) -> None:
        r = monitoring.build_monitoring_fragment(self._spec(dependencies=["api-server"]))
        assert "api-server" in r.dependencies


# ===========================================================================
# Load balancing helper
# ===========================================================================


class TestLoadBalancingHelper:
    def _spec(self, **kwargs: object) -> LoadBalancingSpec:
        defaults = {
            "logical_name": "main-alb",
            "listeners": [ALBListenerSpec(port=80, protocol="HTTP")],
            "target_port": 8080,
        }
        defaults.update(kwargs)
        return LoadBalancingSpec(**defaults)  # type: ignore[arg-type]

    def test_returns_aws_alb(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec())
        assert r.type == "aws_alb"

    def test_internet_facing_generates_assumption(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec(internal=False))
        public_assumptions = [a for a in r.assumptions if a.field == "internal"]
        assert public_assumptions

    def test_internal_alb_no_public_assumption(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec(internal=True))
        public_assumptions = [a for a in r.assumptions if a.field == "internal"]
        assert not public_assumptions

    def test_https_without_cert_generates_unknown(self) -> None:
        spec = self._spec(
            listeners=[ALBListenerSpec(port=443, protocol="HTTPS", certificate_arn="")]
        )
        r = load_balancing.build_load_balancing_fragment(spec)
        cert_unknowns = [u for u in r.unknowns if u.field == "certificate_arn"]
        assert cert_unknowns

    def test_https_with_cert_no_unknown(self) -> None:
        spec = self._spec(
            listeners=[
                ALBListenerSpec(
                    port=443,
                    protocol="HTTPS",
                    certificate_arn="arn:aws:acm:ap-southeast-1:123456789012:certificate/abc",
                )
            ]
        )
        r = load_balancing.build_load_balancing_fragment(spec)
        cert_unknowns = [u for u in r.unknowns if u.field == "certificate_arn"]
        assert not cert_unknowns

    def test_scheme_internet_facing_when_not_internal(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec(internal=False))
        assert r.provider_config["scheme"] == "internet-facing"

    def test_scheme_internal_when_internal(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec(internal=True))
        assert r.provider_config["scheme"] == "internal"

    def test_target_port_in_provider_config(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec(target_port=3000))
        assert r.provider_config["target_port"] == 3000

    def test_health_check_path_in_provider_config(self) -> None:
        r = load_balancing.build_load_balancing_fragment(
            self._spec(health_check_path="/ping")
        )
        assert r.provider_config["health_check_path"] == "/ping"

    def test_public_access_true_when_internet_facing(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec(internal=False))
        assert r.security_settings.public_access is True

    def test_public_access_false_when_internal(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec(internal=True))
        assert r.security_settings.public_access is False

    def test_listeners_serialized(self) -> None:
        r = load_balancing.build_load_balancing_fragment(self._spec())
        listeners = r.provider_config["listeners"]
        assert isinstance(listeners, list)
        assert listeners[0]["port"] == 80


# ===========================================================================
# Combiner
# ===========================================================================


class TestCombiner:
    def _ec2(self, name: str = "api") -> CanonicalResource:
        return compute.build_compute_fragment(
            ComputeSpec(logical_name=name, instance_type="t3.medium", image="ubuntu-24.04")
        )

    def _rds(self, name: str = "db") -> CanonicalResource:
        return database.build_database_fragment(
            DatabaseSpec(logical_name=name, engine="postgres", instance_class="db.t3.micro")
        )

    def test_produces_canonical_manifest(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2(), self._rds()],
            region="ap-southeast-1",
            environment="production",
            metadata=_meta(),
        )
        assert manifest.schema_version == "1.0"
        assert manifest.provider == "aws"
        assert len(manifest.resources) == 2

    def test_fragment_order_preserved(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2("first"), self._rds("second")],
            region="ap-southeast-1",
            environment="production",
            metadata=_meta(),
        )
        assert manifest.resources[0].logical_name == "first"
        assert manifest.resources[1].logical_name == "second"

    def test_manifest_tags_merged_into_fragments(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="ap-southeast-1",
            environment="production",
            metadata=_meta(),
            tags={"env": "prod", "owner": "ops"},
        )
        assert manifest.resources[0].tags["env"] == "prod"
        assert manifest.resources[0].tags["owner"] == "ops"

    def test_fragment_tags_win_on_collision(self) -> None:
        # Fragment has env=staging; manifest has env=prod; fragment must win.
        ec2 = compute.build_compute_fragment(
            ComputeSpec(logical_name="api", instance_type="t3.medium", image="ubuntu-24.04"),
            tags={"env": "staging"},
        )
        manifest = combine_fragments(
            fragments=[ec2],
            region="ap-southeast-1",
            environment="staging",
            metadata=_meta(),
            tags={"env": "prod"},
        )
        assert manifest.resources[0].tags["env"] == "staging"

    def test_manifest_level_tags_set_correctly(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="us-east-1",
            environment="development",
            metadata=_meta(),
            tags={"project": "provisr"},
        )
        assert manifest.tags["project"] == "provisr"

    def test_region_forwarded(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="eu-west-1",
            environment="staging",
            metadata=_meta(),
        )
        assert manifest.region == "eu-west-1"

    def test_environment_forwarded(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="us-east-1",
            environment="sandbox",
            metadata=_meta(),
        )
        assert manifest.environment == "sandbox"

    def test_metadata_forwarded(self) -> None:
        meta = ManifestMetadata(
            request_id="req-xyz",
            workspace_id="ws-abc",
            user_prompt="Deploy a server",
        )
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="us-east-1",
            environment="production",
            metadata=meta,
        )
        assert manifest.metadata.request_id == "req-xyz"
        assert manifest.metadata.workspace_id == "ws-abc"

    def test_cloud_account_forwarded(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="us-east-1",
            environment="production",
            metadata=_meta(),
            cloud_account="123456789012",
        )
        assert manifest.cloud_account == "123456789012"

    def test_monthly_budget_forwarded(self) -> None:
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="us-east-1",
            environment="production",
            metadata=_meta(),
            monthly_budget_usd=500.0,
        )
        assert manifest.monthly_budget_usd == 500.0

    def test_custom_region_source(self) -> None:
        source = FieldSource(source="policy_default", confidence=1.0)
        manifest = combine_fragments(
            fragments=[self._ec2()],
            region="us-east-1",
            environment="production",
            metadata=_meta(),
            region_source=source,
        )
        assert manifest.region_source.source == "policy_default"

    def test_raises_on_empty_fragments(self) -> None:
        with pytest.raises(ValueError, match="at least one fragment"):
            combine_fragments(
                fragments=[],
                region="us-east-1",
                environment="production",
                metadata=_meta(),
            )

    def test_raises_on_duplicate_logical_names(self) -> None:
        with pytest.raises(ValueError, match="Duplicate logical_name"):
            combine_fragments(
                fragments=[self._ec2("same"), self._ec2("same")],
                region="us-east-1",
                environment="production",
                metadata=_meta(),
            )

    def test_full_stack_fragment_combination(self) -> None:
        """Smoke test: all 7 helper types combined into one manifest."""
        vpc = networking.build_networking_fragment(
            NetworkingSpec(logical_name="main-vpc")
        )
        ec2 = compute.build_compute_fragment(
            ComputeSpec(
                logical_name="api",
                instance_type="t3.medium",
                image="ubuntu-24.04",
                dependencies=["main-vpc"],
            )
        )
        db = database.build_database_fragment(
            DatabaseSpec(
                logical_name="db",
                engine="postgres",
                instance_class="db.t3.micro",
                dependencies=["main-vpc"],
            )
        )
        bucket = storage.build_storage_fragment(
            StorageSpec(logical_name="assets", bucket_name="my-assets-bucket")
        )
        cw = monitoring.build_monitoring_fragment(
            MonitoringSpec(
                logical_name="monitoring",
                log_group_name="/app/logs",
                dependencies=["api"],
            )
        )
        alb = load_balancing.build_load_balancing_fragment(
            LoadBalancingSpec(
                logical_name="alb",
                listeners=[ALBListenerSpec(port=80)],
                target_port=8080,
                dependencies=["main-vpc"],
            )
        )
        ecs = containers.build_container_fragment(
            ContainerSpec(
                logical_name="worker",
                image="my-worker:latest",
                dependencies=["alb"],
            )
        )

        manifest = combine_fragments(
            fragments=[vpc, ec2, db, bucket, cw, alb, ecs],
            region="ap-southeast-1",
            environment="production",
            metadata=_meta(),
            tags={"project": "provisr"},
        )

        assert len(manifest.resources) == 7
        types = {r.type for r in manifest.resources}
        assert types == {
            "aws_vpc",
            "aws_ec2",
            "aws_rds",
            "aws_s3",
            "aws_cloudwatch",
            "aws_alb",
            "aws_ecs_service",
        }
        # All resources carry the manifest-level tag
        for resource in manifest.resources:
            assert resource.tags.get("project") == "provisr"
