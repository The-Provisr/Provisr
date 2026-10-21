"""CloudWatch log groups, metric identities and metric alarms."""

from typing import Annotated, Literal

from pydantic import Field, ValidationInfo, field_validator

from .common import Alarm, LogDestination, Metric

AwsResourceRef = Annotated[
    str,
    Field(
        pattern=(
            r"^(manifest:[a-zA-Z0-9_.-]{1,512}|"
            r"arn:aws(-us-gov|-cn)?:[a-z0-9-]+:[a-z0-9-]*:[0-9]{12}:[^\s]+|"
            r"arn:aws(-us-gov|-cn)?:s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$"
        )
    ),
]
SnsTarget = Annotated[
    str,
    Field(
        pattern=(
            r"^arn:aws(-us-gov|-cn)?:sns:[a-z0-9-]+:[0-9]{12}:"
            r"[a-zA-Z0-9_-]{1,256}(\.fifo)?$"
        )
    ),
]


class AwsLogGroup(LogDestination):
    type: Literal["aws_cloudwatch_log_group"]
    name: str = Field(min_length=1, max_length=512, pattern=r"^[.\-_/#a-zA-Z0-9]+$")
    resource_refs: list[AwsResourceRef] = Field(min_length=1, max_length=100)
    # null explicitly requests never-expire, rather than silently assuming it.
    retention_days: (
        Literal[
            1,
            3,
            5,
            7,
            14,
            30,
            60,
            90,
            120,
            150,
            180,
            365,
            400,
            545,
            731,
            1096,
            1827,
            2192,
            2557,
            2922,
            3288,
            3653,
        ]
        | None
    )

    @field_validator("name")
    @classmethod
    def reserved_prefix(cls, value):
        if value.startswith("aws/"):
            raise ValueError("CloudWatch log groups cannot start with aws/")
        return value

    @field_validator("retention_days", mode="before")
    @classmethod
    def explicit_retention(cls, value):
        if value is not None and type(value) is not int:
            raise ValueError("Use an integer retention day count or explicit null for never-expire")
        return value


class AwsMetric(Metric):
    type: Literal["aws_cloudwatch_metric"]
    resource_ref: AwsResourceRef
    metric_name: str = Field(min_length=1, max_length=255, pattern=r"^[^\x00-\x1f]+$")
    namespace: str = Field(min_length=1, max_length=255, pattern=r"^[^:\x00-\x1f]+$")
    dimensions: dict[str, str] = Field(min_length=1, max_length=30)
    statistic: Literal["Average", "Sum", "Minimum", "Maximum", "SampleCount"]
    storage_resolution_seconds: Literal[1, 60]

    @field_validator("storage_resolution_seconds", mode="before")
    @classmethod
    def explicit_resolution(cls, value):
        if type(value) is not int:
            raise ValueError("Storage resolution must be integer seconds")
        return value

    @field_validator("dimensions")
    @classmethod
    def dimension_values(cls, value):
        if any(
            not 1 <= len(k) <= 255
            or not 1 <= len(v) <= 1024
            or k.startswith(":")
            or not k.strip()
            or not v.strip()
            or any(ord(c) < 32 for c in k + v)
            for k, v in value.items()
        ):
            raise ValueError("Provide nonblank dimension names (1..255) and values (1..1024)")
        return value


class AwsAlarm(Alarm):
    type: Literal["aws_cloudwatch_alarm"]
    name: str = Field(min_length=1, max_length=255, pattern=r"^[^\x00-\x1f]+$")
    period_seconds: int = Field(ge=10, le=86400)
    evaluation_periods: int = Field(ge=1)
    datapoints_to_alarm: int = Field(ge=1)
    notification_target_refs: list[SnsTarget] = Field(min_length=1, max_length=5)

    @field_validator("period_seconds")
    @classmethod
    def period(cls, value):
        if value not in {10, 20, 30} and value % 60:
            raise ValueError("Use 10, 20, 30 or a multiple of 60 seconds")
        return value

    @field_validator("evaluation_periods")
    @classmethod
    def window(cls, value, info: ValidationInfo):
        period = info.data.get("period_seconds")
        if period is not None:
            limit = 86400 if period < 3600 else 604800
            if period * value > limit:
                raise ValueError("Evaluation window exceeds CloudWatch limit")
        return value

    @field_validator("datapoints_to_alarm")
    @classmethod
    def datapoints(cls, value, info: ValidationInfo):
        if value > info.data.get("evaluation_periods", value):
            raise ValueError("Cannot exceed evaluation_periods")
        return value
