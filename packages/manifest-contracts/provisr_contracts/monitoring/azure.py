"""Azure Monitor Log Analytics destinations and static metric alerts."""

from typing import Annotated, Literal

from pydantic import Field, ValidationInfo, field_validator

from .common import Alarm, LogDestination, Metric

AzureResourceRef = Annotated[
    str,
    Field(
        pattern=(
            r"^(manifest:[a-zA-Z0-9_.-]{1,512}|/subscriptions/"
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/"
            r"resourceGroups/[^/\s]+/providers/[a-zA-Z0-9.]+(/[^/\s]+/[^/\s]+)+)$"
        )
    ),
]
ActionGroup = Annotated[
    str,
    Field(
        pattern=(
            r"^/subscriptions/"
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/"
            r"resourceGroups/[^/\s]+/providers/"
            r"Microsoft\.Insights/actionGroups/[^/\s]+$"
        )
    ),
]


class AzureLogWorkspace(LogDestination):
    type: Literal["azure_log_analytics_workspace"]
    name: str = Field(min_length=4, max_length=63, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$")
    resource_refs: list[AzureResourceRef] = Field(min_length=1, max_length=100)
    retention_days: int = Field(ge=30, le=730)
    sku: Literal["PerGB2018"]


class AzureMetric(Metric):
    type: Literal["azure_monitor_metric"]
    resource_ref: AzureResourceRef
    namespace: str = Field(min_length=1, max_length=255, pattern=r"^[a-zA-Z0-9.]+/[a-zA-Z0-9/]+$")
    aggregation: Literal["Average", "Count", "Minimum", "Maximum", "Total"]

    @field_validator("namespace")
    @classmethod
    def resource_namespace(cls, value, info: ValidationInfo):
        ref = info.data.get("resource_ref", "")
        if "/providers/" in ref:
            parts = ref.split("/providers/")[-1].split("/")
            expected = "/".join([parts[0], *parts[1::2]])
            if value.lower() != expected.lower():
                raise ValueError(f"Metric namespace must match monitored resource type {expected}")
        return value


class AzureAlarm(Alarm):
    type: Literal["azure_monitor_alarm"]
    name: str = Field(min_length=1, max_length=260, pattern=r"^[^\s*#&+:<>?%{}\\/]+$")
    # Azure static metric alerts do not expose CloudWatch missing-data choices.
    missing_data: Literal["ignore"]
    window_seconds: Literal[60, 300, 900, 1800, 3600, 21600, 43200, 86400]
    evaluation_frequency_seconds: Literal[60, 300, 900, 1800, 3600]
    severity: int = Field(ge=0, le=4)
    notification_target_refs: list[ActionGroup] = Field(min_length=1, max_length=5)
