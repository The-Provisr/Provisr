"""MCP-028 contract, authorization and composition proofs; no cloud clients."""

import asyncio
import copy
import json
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from provisr_contracts.manifest import ResourceManifest
from pydantic import ValidationError

from src.domain.monitoring import generate_monitoring_manifest, validate_monitoring_request
from src.servers.manifest_validation import validate_contextual_manifest, validate_schema
from src.servers.policy_server import create_app

EXAMPLES = Path(__file__).resolve().parents[1] / "examples/monitoring"
ID = "05a0cb9b-6793-4d47-ac80-c37916dc7b57"
CONTEXT = {
    "workspace_id": ID,
    "user_id": ID,
    "request_id": ID,
    "correlation_id": ID,
    "session_id": ID,
    "permissions": ["manifest:write"],
}


def example(provider):
    return json.loads((EXAMPLES / f"{provider}.json").read_text())


def full_manifest(fragment):
    return {
        **fragment,
        "schema_version": "1.0",
        "environment": "development",
        "tags": {},
        "security": {"encryption_enabled": True},
        "backup": {"enabled": False},
        "policy": {"requirements_loaded": True, "applied_constraints": []},
    }


@pytest.mark.parametrize("provider", ["aws", "azure", "gcp"])
def test_generation_validation_and_full_manifest(provider):
    requirements = example(provider)
    original = copy.deepcopy(requirements)
    result = generate_monitoring_manifest(requirements)
    assert requirements == original
    assert result["valid"] is True
    assert result["fragment"] == requirements
    assert generate_monitoring_manifest(requirements) == result
    assert validate_monitoring_request(result["fragment"])["valid"] is True
    manifest = full_manifest(result["fragment"])
    assert validate_schema(manifest) == []
    assert ResourceManifest.model_validate(manifest).provider == provider
    cloud = {
        "active_accounts": [
            {
                "workspace_id": ID,
                "provider": provider,
                "status": "active",
                "verified_at": "2026-10-21T00:00:00Z",
                "supported_regions": [manifest["region"]],
            }
        ]
    }
    assert validate_contextual_manifest(manifest, cloud, {"enabled": False}, ID) == []
    policy = {
        "enabled": True,
        "allowed_regions": [manifest["region"]],
        "prohibited_resource_types": [manifest["resources"][0]["type"]],
    }
    assert "prohibited" in str(validate_contextual_manifest(manifest, cloud, policy, ID))
    cloud["active_accounts"][0]["workspace_id"] = "foreign"
    assert validate_contextual_manifest(manifest, cloud, {"enabled": False}, ID)


@pytest.mark.parametrize("value", [None, [], {}, {"provider": "other"}, "monitor this"])
def test_invalid_shapes_return_actionable_errors(value):
    for result in (generate_monitoring_manifest(value), validate_monitoring_request(value)):
        assert result["valid"] is False
        assert result["errors"]
        assert all(set(error) == {"field", "code", "message"} for error in result["errors"])


@pytest.mark.parametrize("provider", ["aws", "azure", "gcp"])
@pytest.mark.parametrize("field", ["name", "retention_days"])
def test_missing_log_information(provider, field):
    fragment = example(provider)
    del fragment["resources"][0][field]
    result = generate_monitoring_manifest(fragment)
    assert result["fragment"] is None
    assert any(error["field"].endswith(field) for error in result["errors"])


@pytest.mark.parametrize(
    "provider,days,valid",
    [
        ("aws", None, True),
        ("aws", 1, True),
        ("aws", 3653, True),
        ("aws", 0, False),
        ("aws", 2, False),
        ("aws", 3654, False),
        ("azure", 30, True),
        ("azure", 730, True),
        ("azure", 29, False),
        ("azure", 731, False),
        ("azure", None, False),
        ("gcp", 1, True),
        ("gcp", 3650, True),
        ("gcp", 0, False),
        ("gcp", 3651, False),
    ],
)
def test_retention_boundaries(provider, days, valid):
    fragment = example(provider)
    fragment["resources"][0]["retention_days"] = days
    assert validate_monitoring_request(fragment)["valid"] is valid


@pytest.mark.parametrize(
    "provider,changes,valid",
    [
        ("aws", {"period_seconds": 60, "evaluation_periods": 1440}, True),
        ("aws", {"period_seconds": 60, "evaluation_periods": 1441}, False),
        ("aws", {"period_seconds": 3600, "evaluation_periods": 168}, True),
        ("aws", {"period_seconds": 3600, "evaluation_periods": 169}, False),
        ("aws", {"datapoints_to_alarm": 0}, False),
        ("azure", {"severity": 0, "window_seconds": 60}, True),
        ("azure", {"severity": 4, "window_seconds": 86400}, True),
        ("azure", {"severity": -1}, False),
        ("gcp", {"duration_seconds": 60}, True),
        ("gcp", {"duration_seconds": 86400}, True),
        ("gcp", {"duration_seconds": 86460}, False),
        (
            "gcp",
            {"notification_target_refs": ["projects/foreign-project/notificationChannels/1"]},
            False,
        ),
    ],
)
def test_alarm_boundaries(provider, changes, valid):
    fragment = example(provider)
    fragment["resources"][2].update(changes)
    assert validate_monitoring_request(fragment)["valid"] is valid


def test_valid_high_resolution_alarm():
    fragment = example("aws")
    fragment["resources"][1]["storage_resolution_seconds"] = 1
    fragment["resources"][2]["period_seconds"] = 10
    assert validate_monitoring_request(fragment)["valid"] is True


@pytest.mark.parametrize("provider", ["aws", "azure", "gcp"])
@pytest.mark.parametrize(
    "index,changes",
    [
        (0, {"retention_days": True}),
        (0, {"resource_refs": []}),
        (1, {"resource_ref": "not-a-resource"}),
        (1, {"metric_name": ""}),
        (1, {"metric_name": "   "}),
        (2, {"notification_target_refs": []}),
        (2, {"threshold": True}),
        (2, {"unexpected": "value"}),
    ],
)
def test_strict_fields_and_reference_shapes(provider, index, changes):
    fragment = example(provider)
    fragment["resources"][index].update(changes)
    result = validate_monitoring_request(fragment)
    assert result["valid"] is False
    assert all(error["field"].startswith(f"resources.{index}.") for error in result["errors"])


@pytest.mark.parametrize(
    "provider,index,field,value",
    [
        ("aws", 0, "name", "aws/reserved"),
        ("aws", 0, "name", "bad name"),
        ("aws", 1, "dimensions", {"InstanceId": ""}),
        ("aws", 1, "namespace", ":bad"),
        ("aws", 2, "period_seconds", 59),
        ("aws", 2, "period_seconds", 10),
        ("aws", 2, "evaluation_periods", 289),
        ("aws", 2, "datapoints_to_alarm", 4),
        ("aws", 2, "threshold", "80"),
        ("aws", 2, "threshold", float("inf")),
        ("aws", 2, "notification_target_refs", ["person@example.com"]),
        ("aws", 2, "notification_target_refs", ["arn:aws:sns:us-west-2:123456789012:alerts"]),
        ("azure", 0, "name", "abc"),
        ("azure", 0, "sku", "Free"),
        ("azure", 1, "namespace", "AWS/EC2"),
        ("azure", 2, "window_seconds", 120),
        ("azure", 2, "severity", 5),
        ("azure", 2, "evaluation_frequency_seconds", 900),
        ("azure", 2, "missing_data", "breaching"),
        ("azure", 2, "notification_target_refs", ["projects/tester/notificationChannels/1"]),
        ("gcp", 0, "name", "_Required"),
        ("gcp", 0, "filter", ""),
        ("gcp", 1, "metric_name", "CPUUtilization"),
        ("gcp", 1, "filter", 'metric.type="wrong"'),
        ("gcp", 1, "alignment_period_seconds", 59),
        ("gcp", 2, "duration_seconds", 61),
        ("gcp", 2, "duration_seconds", 0),
        ("gcp", 2, "trigger_count", 0),
        ("gcp", 2, "comparison", "greater_than_or_equal"),
        ("gcp", 2, "notification_target_refs", ["person@example.com"]),
    ],
)
def test_provider_specific_invalid_fields(provider, index, field, value):
    fragment = example(provider)
    fragment["resources"][index][field] = value
    assert validate_monitoring_request(fragment)["valid"] is False


@pytest.mark.parametrize("provider", ["aws", "azure", "gcp"])
@pytest.mark.parametrize(
    "field", ["threshold", "comparison", "missing_data", "notification_target_refs"]
)
def test_no_invented_alert_settings(provider, field):
    fragment = example(provider)
    del fragment["resources"][2][field]
    result = generate_monitoring_manifest(fragment)
    assert result["fragment"] is None
    assert any(error["field"].endswith(field) for error in result["errors"])


@pytest.mark.parametrize("provider", ["aws", "azure", "gcp"])
def test_reference_and_provider_integrity(provider):
    fragment = example(provider)
    fragment["resources"][2]["metric_ref"] = "missing"
    result = validate_monitoring_request(fragment)
    assert result["valid"] is False
    assert result["errors"][0]["field"] == "resources.2.metric_ref"
    fragment = example(provider)
    fragment["resources"][1]["name"] = fragment["resources"][0]["name"] = "duplicate"
    assert validate_monitoring_request(fragment)["valid"] is False
    fragment = example(provider)
    fragment["provider"] = "azure" if provider == "aws" else "aws"
    assert validate_monitoring_request(fragment)["valid"] is False
    assert validate_schema(full_manifest(fragment))


def test_fragment_references_are_resolved_in_full_manifest():
    fragment = example("aws")
    fragment["resources"][1]["resource_ref"] = "manifest:api"
    fragment["resources"][0]["resource_refs"] = ["manifest:api"]
    result = generate_monitoring_manifest(fragment)
    assert result["valid"] is True
    assert result["deferred_resource_refs"] == ["manifest:api"]
    manifest = full_manifest(result["fragment"])
    assert validate_schema(manifest)
    with pytest.raises(ValidationError):
        ResourceManifest.model_validate(manifest)
    manifest["resources"].append(
        {
            "type": "aws_ec2",
            "name": "api",
            "instance_type": "t3.medium",
            "image": "ubuntu-24.04",
        }
    )
    assert validate_schema(manifest) == []
    manifest["resources"][1]["resource_ref"] = "manifest:api_cpu"
    assert validate_schema(manifest)


class Membership:
    def __init__(self, role="engineer"):
        self.role = role
        self.calls = []

    async def get_role(self, *, user_id: UUID, workspace_id: UUID):
        self.calls.append((user_id, workspace_id))
        return self.role if str(workspace_id) == ID else None


@pytest.mark.parametrize("provider", ["aws", "azure", "gcp"])
def test_mounted_endpoints_are_stateless_and_do_not_call_cloud(provider):
    calls = []

    def reject_network(request):
        calls.append(request)
        raise AssertionError("Monitoring tools must not make outbound calls")

    membership = Membership()
    http_client = httpx.AsyncClient(transport=httpx.MockTransport(reject_network))
    try:
        with TestClient(create_app(membership_store=membership, http_client=http_client)) as client:
            fragment = example(provider)
            generated = client.post(
                "/tools/generate_monitoring_manifest",
                json={
                    "context": CONTEXT,
                    "requirements": fragment,
                },
            )
            assert generated.status_code == 200
            assert generated.json()["fragment"] == fragment
            validated = client.post(
                "/tools/validate_monitoring_request",
                json={
                    "context": CONTEXT,
                    "fragment": fragment,
                },
            )
            assert validated.json()["valid"] is True
            for tool in ("validate_manifest", "validate_manifest_schema"):
                cloud = {
                    "active_accounts": [
                        {
                            "workspace_id": ID,
                            "provider": provider,
                            "status": "active",
                            "verified_at": "2026-10-21T00:00:00Z",
                            "supported_regions": [fragment["region"]],
                        }
                    ]
                }
                response = client.post(
                    f"/tools/{tool}",
                    json={
                        "context": CONTEXT,
                        "manifest": full_manifest(fragment),
                        "cloud_context": cloud,
                        "policy_context": {"enabled": False},
                    },
                )
                assert response.json()["valid"] is True
        assert len(membership.calls) == 4
        assert calls == []
    finally:
        asyncio.run(http_client.aclose())


@pytest.mark.parametrize("tool", ["generate_monitoring_manifest", "validate_monitoring_request"])
@pytest.mark.parametrize(
    "context,role",
    [
        (None, "engineer"),
        ({}, "engineer"),
        ({**CONTEXT, "permissions": ["policy:read"]}, "engineer"),
        (CONTEXT, None),
        ({**CONTEXT, "workspace_id": "05a0cb9b-6793-4d47-ac80-c37916dc7b58"}, "engineer"),
        ({**CONTEXT, "user_id": "malformed"}, "engineer"),
    ],
)
def test_unauthorized_context_precedes_tool_processing(tool, context, role, monkeypatch):
    def reject_processing(_):
        raise AssertionError("Tool-specific processing must not precede authorization")

    monkeypatch.setattr(f"src.servers.domain_server.{tool}", reject_processing)
    with TestClient(create_app(membership_store=Membership(role))) as client:
        response = client.post(
            f"/tools/{tool}",
            json={
                "context": context,
                "requirements": "invalid",
                "fragment": "invalid",
            },
        )
        assert response.status_code == 403
        assert response.json()["error"] == "invalid_context"


@pytest.mark.parametrize("tool", ["generate_monitoring_manifest", "validate_monitoring_request"])
def test_malformed_json_is_context_error(tool):
    with TestClient(create_app(membership_store=Membership())) as client:
        assert client.post(f"/tools/{tool}", content="{").status_code == 403
