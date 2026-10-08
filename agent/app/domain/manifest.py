"""Manifest models for the Provisr agent.

Two manifest tiers:

``ResourceManifest``
    The compact, model-parseable wire format Claude returns. Validated at the
    boundary where the LLM response is deserialized.  Used for prompt contract
    documentation and model output parsing.

``CanonicalManifest``
    The fully-annotated draft produced by ``app.domain.drafting`` and the
    domain planning helpers (AG-012).  Every field carries a ``FieldSource``
    annotation so downstream orchestration, policy, and audit services know
    exactly where each value came from and how confident the agent was.
    This is the ``manifest_draft`` envelope emitted as an SSE event (AG-005).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Shared base
# ---------------------------------------------------------------------------


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Source-metadata annotation (per field, per resource)
# ---------------------------------------------------------------------------

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
    tags: dict[str, str] = Field(default_factory=dict)
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
    tags: dict[str, str] = Field(default_factory=dict)
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


# ---------------------------------------------------------------------------
# Original compact wire-format (kept for LLM response parsing)
# ---------------------------------------------------------------------------


class Ec2Resource(StrictModel):
    type: Literal["aws_ec2"]
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    instance_type: str = Field(min_length=1, max_length=64)
    image: str = Field(min_length=1, max_length=128)
    count: int = Field(default=1, ge=1, le=20)


class RdsResource(StrictModel):
    type: Literal["aws_rds"]
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    engine: Literal["postgres", "mysql"]
    instance_class: str = Field(min_length=1, max_length=64)
    allocated_storage_gb: int = Field(ge=20, le=16384)


class S3Resource(StrictModel):
    type: Literal["aws_s3"]
    name: str = Field(min_length=3, max_length=63, pattern=r"^[a-z0-9][a-z0-9.-]+[a-z0-9]$")
    versioning: bool = True


AwsResource = Annotated[Ec2Resource | RdsResource | S3Resource, Field(discriminator="type")]


class ResourceManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    provider: Literal["aws"] = "aws"
    region: str = Field(min_length=3, max_length=32)
    environment: Literal["development", "staging", "production", "sandbox"]
    monthly_budget_usd: float | None = Field(default=None, gt=0)
    tags: dict[str, str] = Field(default_factory=dict)
    resources: list[AwsResource] = Field(min_length=1, max_length=50)
