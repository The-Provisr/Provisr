"""Shared monitoring intent; provider modules own native constraints."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

NonEmpty = Annotated[str, Field(min_length=1, max_length=1024)]
LogicalName = Annotated[str, Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")]


class MonitoringModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    @field_validator("*")
    @classmethod
    def nonblank_strings(cls, value):
        if isinstance(value, str) and not value.strip():
            raise ValueError("Provide a nonblank value")
        return value


class Metric(MonitoringModel):
    name: LogicalName
    resource_ref: NonEmpty
    metric_name: NonEmpty


class Alarm(MonitoringModel):
    name: NonEmpty
    metric_ref: LogicalName
    threshold: float
    comparison: Literal["greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal"]
    # Explicitly required: never choose a consequential missing-data behavior.
    missing_data: Literal["breaching", "not_breaching", "ignore", "missing"]


class LogDestination(MonitoringModel):
    name: NonEmpty
    resource_refs: list[NonEmpty] = Field(min_length=1, max_length=100)
