"""Cloud Logging buckets and Cloud Monitoring metric-threshold policies."""

import re
from typing import Annotated, Literal

from pydantic import Field, ValidationInfo, field_validator

from .common import Alarm, LogDestination, Metric

GcpResourceRef = Annotated[
    str,
    Field(
        pattern=(
            r"^(manifest:[a-zA-Z0-9_.-]{1,512}|//[a-z][a-z0-9.]+\.googleapis\.com/"
            r"projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/[^\s]+)$"
        )
    ),
]
NotificationChannel = Annotated[
    str, Field(pattern=(r"^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/notificationChannels/[0-9]+$"))
]


class GcpLogBucket(LogDestination):
    type: Literal["gcp_logging_bucket"]
    name: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")
    project_id: str = Field(pattern=r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
    location: str = Field(min_length=1, max_length=63, pattern=r"^[a-z0-9-]+$")
    resource_refs: list[GcpResourceRef] = Field(min_length=1, max_length=100)
    retention_days: int = Field(ge=1, le=3650)
    # Explicit sink filter is required; collecting every log is not an assumption.
    filter: str = Field(min_length=1, max_length=20000)


class GcpMetric(Metric):
    type: Literal["gcp_monitoring_metric"]
    resource_ref: GcpResourceRef
    metric_name: str = Field(pattern=r"^[a-z][a-z0-9.]+\.googleapis\.com/[a-zA-Z0-9_/]+$")
    monitored_resource_type: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    filter: str = Field(min_length=1, max_length=20000)
    alignment_period_seconds: int = Field(ge=60, le=90000)
    per_series_aligner: Literal["ALIGN_MEAN", "ALIGN_MAX", "ALIGN_MIN", "ALIGN_SUM", "ALIGN_RATE"]

    @field_validator("filter")
    @classmethod
    def metric_filter(cls, value, info: ValidationInfo):
        clause = (
            r"(metric\.type|resource\.type|(resource|metric)\.labels\.[a-z_][a-z0-9_]*)"
            r'\s*=\s*"[^"\\\r\n]+"'
        )
        if not re.fullmatch(rf"{clause}(\s+AND\s+{clause})*", value):
            raise ValueError(
                "Use equality selectors joined by AND for this metric-threshold filter"
            )
        for key, field in (
            ("metric.type", "metric_name"),
            ("resource.type", "monitored_resource_type"),
        ):
            expected = info.data.get(field)
            matches = re.findall(rf'{re.escape(key)}\s*=\s*"([^"]+)"', value)
            if expected is not None and matches != [expected]:
                raise ValueError(f'filter: require exactly {key}="{expected}"')
        return value


class GcpAlarm(Alarm):
    type: Literal["gcp_monitoring_alarm"]
    name: str = Field(min_length=1, max_length=512, pattern=r"^[^\x00-\x1f]+$")
    project_id: str = Field(pattern=r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
    comparison: Literal["greater_than", "less_than"]
    missing_data: Literal["breaching", "not_breaching", "ignore"]
    duration_seconds: int = Field(ge=60, le=86400, multiple_of=60)
    trigger_count: int = Field(ge=1)
    notification_target_refs: list[NotificationChannel] = Field(min_length=1, max_length=16)

    @field_validator("notification_target_refs")
    @classmethod
    def channel_project(cls, value, info: ValidationInfo):
        project = info.data.get("project_id")
        if project and any(ref.split("/")[1] != project for ref in value):
            raise ValueError("Notification channels must belong to the alert policy project_id")
        return value
