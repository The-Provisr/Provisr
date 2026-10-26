from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from .monitoring import MonitoringResource, check_resources

# A policy required-tag value meaning the key must be present with any
# non-blank value; the policy service mandates tag keys, not values.
ANY_TAG_VALUE = "*"


def _reject_tag_placeholder(tags: dict[str, str]) -> dict[str, str]:
    """ANY_TAG_VALUE is a policy placeholder, never a real tag value."""
    placeholders = sorted(key for key, value in tags.items() if value.strip() == ANY_TAG_VALUE)
    if placeholders:
        raise ValueError(
            f"tags {', '.join(placeholders)} use the placeholder {ANY_TAG_VALUE!r}; "
            "a real value is required"
        )
    return tags


TagMap = Annotated[dict[str, str], AfterValidator(_reject_tag_placeholder)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SecurityConfiguration(StrictModel):
    encryption_enabled: bool


class BackupConfiguration(StrictModel):
    enabled: bool


type PolicyConstraintName = Literal[
    "allowed_regions",
    "max_budget",
    "required_tags",
    "prohibited_resource_types",
    "required_encryption",
    "required_backup",
]


class PolicyApplication(StrictModel):
    requirements_loaded: Literal[True]
    applied_constraints: tuple[PolicyConstraintName, ...]


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
    provider: Literal["aws", "azure", "gcp"] = "aws"
    region: str = Field(min_length=3, max_length=32)
    environment: Literal["development", "staging", "production", "sandbox"]
    monthly_budget_usd: float | None = Field(default=None, gt=0)
    tags: TagMap = Field(default_factory=dict)
    security: SecurityConfiguration
    backup: BackupConfiguration
    policy: PolicyApplication
    resources: list[Annotated[AwsResource | MonitoringResource, Field(discriminator="type")]] = (
        Field(
            min_length=1,
            max_length=50,
        )
    )

    @model_validator(mode="after")
    def resource_integrity(self):
        check_resources(
            self.provider,
            self.resources,
            allow_external_manifest_refs=False,
            region=self.region,
        )
        return self
