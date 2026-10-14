import copy
import json
import sys
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from src.servers.manifest_validation import validate_contextual_manifest, validate_schema
from src.servers.policy_server import create_app

WORKSPACE = "05a0cb9b-6793-4d47-ac80-c37916dc7b57"
MANIFEST = {
    "schema_version": "1.0", "provider": "aws", "region": "us-east-1",
    "environment": "development", "monthly_budget_usd": 100,
    "tags": {"owner": "platform"}, "security": {"encryption_enabled": True},
    "backup": {"enabled": True},
    "policy": {"requirements_loaded": True, "applied_constraints": ["allowed_regions"]},
    "resources": [{"type": "aws_s3", "name": "test-provisr-bucket", "versioning": True}],
}
CLOUD = {"active_accounts": [{"workspace_id": WORKSPACE, "provider": "aws", "status": "active",
                            "verified_at": "2026-10-09T00:00:00Z", "supported_regions": ["us-east-1"]}]}
POLICY = {"enabled": True, "allowed_regions": ["us-east-1"], "max_budget": 500,
          "required_tags": {"owner": "platform"}, "required_encryption": True,
          "required_backup": True, "prohibited_resource_types": []}


def test_manifest_schema_matches_agent_source() -> None:
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "agent"))
    from app.domain.manifest import ResourceManifest
    schema = json.loads((root / "mcp/src/servers/manifest.schema.json").read_text())
    assert schema == ResourceManifest.model_json_schema()


def test_valid_draft() -> None:
    assert validate_schema(MANIFEST) == []
    assert validate_contextual_manifest(MANIFEST, CLOUD, POLICY, WORKSPACE) == []


@pytest.mark.parametrize("change", [
    {"provider": "gcp"}, {"region": "us-west-2"}, {"monthly_budget_usd": 1000},
    {"tags": {}}, {"security": {"encryption_enabled": False}},
    {"backup": {"enabled": False}}, {"resources": []}, {"unexpected": True},
])
def test_invalid_or_noncompliant_draft(change: dict[str, object]) -> None:
    manifest = copy.deepcopy(MANIFEST)
    manifest.update(change)
    assert validate_contextual_manifest(manifest, CLOUD, POLICY, WORKSPACE)


def test_empty_allowed_regions_snapshot_is_unrestricted() -> None:
    policy = {**POLICY, "allowed_regions": []}
    assert validate_contextual_manifest(MANIFEST, CLOUD, policy, WORKSPACE) == []


@pytest.mark.parametrize(
    ("tags", "valid"),
    [
        ({"owner": "platform", "Team": "payments"}, True),
        ({"owner": "platform"}, False),
        ({"owner": "platform", "Team": ""}, False),
        ({"owner": "platform", "Team": "  "}, False),
        ({"owner": "platform", "Team": "*"}, False),
        ({"owner": "other", "Team": "payments"}, False),
    ],
)
def test_key_only_required_tags(tags: dict[str, str], valid: bool) -> None:
    policy = {**POLICY, "required_tags": {"owner": "platform", "Team": "*"}}
    manifest = {**MANIFEST, "tags": tags}
    errors = validate_contextual_manifest(manifest, CLOUD, policy, WORKSPACE)
    assert (errors == []) is valid
    if not valid:
        assert errors == ["Required policy tags are missing"]


def test_disconnected_or_foreign_account() -> None:
    for change in [{"status": "disconnected"}, {"workspace_id": "other"}, {"verified_at": None}]:
        cloud = copy.deepcopy(CLOUD)
        cloud["active_accounts"][0].update(change)
        assert validate_contextual_manifest(MANIFEST, cloud, POLICY, WORKSPACE)


def test_tools_require_authorized_context() -> None:
    class Membership:
        async def get_role(self, *, user_id: UUID, workspace_id: UUID) -> str | None:
            return "engineer" if str(workspace_id) == WORKSPACE else None
    context = {"workspace_id": WORKSPACE, "user_id": WORKSPACE, "request_id": WORKSPACE,
               "correlation_id": WORKSPACE, "session_id": WORKSPACE, "permissions": ["manifest:write"]}
    with TestClient(create_app(membership_store=Membership())) as client:
        for tool in ["validate_manifest", "validate_manifest_schema"]:
            assert client.post(f"/tools/{tool}", json={"manifest": MANIFEST}).status_code == 403
            result = client.post(f"/tools/{tool}", json={"context": context, "manifest": MANIFEST,
                                 "cloud_context": CLOUD, "policy_context": POLICY})
            assert result.status_code == 200
            assert result.json()["valid"] is True
