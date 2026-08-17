import pytest
from pydantic import ValidationError

from app.domain.manifest import ResourceManifest


def test_accepts_an_aws_ec2_manifest() -> None:
    manifest = ResourceManifest.model_validate(
        {
            "schema_version": "1.0",
            "provider": "aws",
            "region": "ap-southeast-1",
            "environment": "staging",
            "monthly_budget_usd": 80,
            "tags": {"owner": "platform"},
            "security": {"encryption_enabled": True},
            "backup": {"enabled": True},
            "policy": {
                "requirements_loaded": True,
                "applied_constraints": ["allowed_regions"],
            },
            "resources": [
                {
                    "type": "aws_ec2",
                    "name": "private-api",
                    "instance_type": "t3.medium",
                    "image": "ubuntu-24.04",
                }
            ],
        }
    )

    assert manifest.resources[0].type == "aws_ec2"


def test_rejects_an_unknown_resource_type() -> None:
    with pytest.raises(ValidationError):
        ResourceManifest.model_validate(
            {
                "region": "ap-southeast-1",
                "environment": "staging",
                "security": {"encryption_enabled": True},
                "backup": {"enabled": True},
                "policy": {
                    "requirements_loaded": True,
                    "applied_constraints": ["allowed_regions"],
                },
                "resources": [{"type": "made_up", "name": "unsafe"}],
            }
        )
