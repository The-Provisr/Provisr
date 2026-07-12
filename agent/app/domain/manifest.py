from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


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
