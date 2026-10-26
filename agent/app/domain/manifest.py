"""Agent import path for the canonical shared runtime manifest contract."""

from typing import Literal

from provisr_contracts.manifest import (
    ANY_TAG_VALUE,
    AwsResource,
    BackupConfiguration,
    Ec2Resource,
    PolicyApplication,
    PolicyConstraintName,
    RdsResource,
    ResourceManifest,
    S3Resource,
    SecurityConfiguration,
    StrictModel,
    TagMap,
)
from pydantic import Field

type FieldSourceKind = Literal[
    "user_prompt",
    "policy_default",
    "cloud_state",
    "ai_assumption",
]


class FieldSource(StrictModel):
    """Provenance and confidence annotation for a single inferred or resolved value.

    ``confidence`` is a float in [0.0, 1.0].  Any value below 0.9 must trigger
    a user-confirmation question before the manifest is finalised (AGENTS.md).
    """

    source: FieldSourceKind
    confidence: float = Field(ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Resource-level enrichment models
# ---------------------------------------------------------------------------


class SecuritySettings(StrictModel):
    """Security posture applied to a resource."""

    encryption_enabled: bool = True
    public_access: bool = False
    encryption_type: str = Field(default="AES256", max_length=32)


class CostEstimate(StrictModel):
    """Rough monthly cost estimate attached to a single resource."""

    estimated_monthly_usd: float = Field(ge=0.0)
    confidence_pct: int = Field(ge=0, le=100)
    source: Literal["agent_estimate", "mcp_cost_tool"] = "agent_estimate"


class ResourceAssumption(StrictModel):
    """A value the agent inferred without explicit user confirmation."""

    field: str = Field(min_length=1, max_length=128)
    assumed_value: str = Field(min_length=1, max_length=256)
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(min_length=1, max_length=512)


class UnknownField(StrictModel):
    """A required field whose value could not be resolved or inferred."""

    field: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=1, max_length=512)


# ---------------------------------------------------------------------------
# Canonical resource — provider-neutral with enrichment
# ---------------------------------------------------------------------------


class CanonicalResource(StrictModel):
    """A single resource in the canonical manifest.

    ``provider_config`` holds the provider-specific fields verbatim from the
    helper or model (e.g. ``instance_type``, ``engine``) so they are preserved
    without being re-validated here — validation happens in the provisioning
    service that actually drives Terraform.
    """

    logical_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    type: str = Field(min_length=1, max_length=64)
    provider_config: dict[str, object] = Field(default_factory=dict)
    dependencies: list[str] = Field(default_factory=list, max_length=20)
    tags: TagMap = Field(default_factory=dict)
    security_settings: SecuritySettings = Field(default_factory=SecuritySettings)
    cost_estimate: CostEstimate | None = None
    policy_refs: list[str] = Field(default_factory=list, max_length=20)
    unknowns: list[UnknownField] = Field(default_factory=list, max_length=20)
    assumptions: list[ResourceAssumption] = Field(default_factory=list, max_length=20)
    # Source provenance for this resource entry itself
    source_metadata: FieldSource = Field(
        default_factory=lambda: FieldSource(source="user_prompt", confidence=1.0)
    )


# ---------------------------------------------------------------------------
# Canonical manifest metadata
# ---------------------------------------------------------------------------


class ManifestMetadata(StrictModel):
    """Trace context and user-visible description for the manifest draft."""

    request_id: str = Field(min_length=1, max_length=128)
    workspace_id: str = Field(min_length=1, max_length=128)
    user_prompt: str = Field(min_length=1, max_length=20000)


# ---------------------------------------------------------------------------
# Canonical manifest (AG-005 manifest_draft envelope)
# ---------------------------------------------------------------------------


class CanonicalManifest(StrictModel):
    """Fully-annotated infrastructure manifest produced by the agent drafting step.

    This is the ``manifest_draft`` envelope (AG-005).  It is *not* the model
    output format — it is the enriched, policy-checked artefact handed off to
    orchestration after the agent planning loop completes.
    """

    schema_version: Literal["1.0"] = "1.0"
    provider: Literal["aws"] = "aws"
    region: str = Field(min_length=3, max_length=32)
    cloud_account: str = Field(default="", max_length=128)
    environment: Literal["development", "staging", "production", "sandbox"]
    metadata: ManifestMetadata
    tags: TagMap = Field(default_factory=dict)
    monthly_budget_usd: float | None = Field(default=None, gt=0)
    resources: list[CanonicalResource] = Field(min_length=1, max_length=50)
    # Top-level source provenance for key manifest fields
    region_source: FieldSource = Field(
        default_factory=lambda: FieldSource(source="user_prompt", confidence=1.0)
    )
    environment_source: FieldSource = Field(
        default_factory=lambda: FieldSource(source="user_prompt", confidence=1.0)
    )
    provider_source: FieldSource = Field(
        default_factory=lambda: FieldSource(source="user_prompt", confidence=1.0)
    )

__all__ = ['ANY_TAG_VALUE', 'AwsResource', 'BackupConfiguration', 'Ec2Resource', 'PolicyApplication', 'PolicyConstraintName', 'RdsResource', 'ResourceManifest', 'S3Resource', 'SecurityConfiguration', 'StrictModel', 'TagMap']
