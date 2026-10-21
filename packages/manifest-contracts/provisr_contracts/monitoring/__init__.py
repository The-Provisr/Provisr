"""Domain-first, provider-second monitoring resource union and integrity checks."""

from typing import Annotated, Literal

from pydantic import Field, ValidationError, model_validator

from .aws import AwsAlarm, AwsLogGroup, AwsMetric
from .azure import AzureAlarm, AzureLogWorkspace, AzureMetric
from .common import Alarm, LogDestination, Metric, MonitoringModel
from .gcp import GcpAlarm, GcpLogBucket, GcpMetric

MonitoringResource = Annotated[
    AwsLogGroup
    | AwsMetric
    | AwsAlarm
    | AzureLogWorkspace
    | AzureMetric
    | AzureAlarm
    | GcpLogBucket
    | GcpMetric
    | GcpAlarm,
    Field(discriminator="type"),
]


def check_resources(
    provider: str,
    resources: list,
    *,
    allow_external_manifest_refs: bool,
    region: str | None = None,
) -> None:
    """Check graph integrity in both fragments and complete manifests.

    Fragments may defer manifest:name references. Full manifests must resolve them.
    Native resource and notification IDs are syntax-checked, never existence claims.
    """
    errors = []
    names = {resource.name: resource for resource in resources}
    seen = set()

    def error(index: int, field: str, message: str) -> None:
        errors.append(
            {
                "type": "value_error",
                "loc": ("resources", index, field),
                "input": None,
                "ctx": {"error": ValueError(message)},
            }
        )

    for index, resource in enumerate(resources):
        if resource.name in seen:
            error(index, "name", "Resource names must be unique in the manifest")
        seen.add(resource.name)
        if not resource.type.startswith(f"{provider}_"):
            error(index, "type", "Resource provider must match the fragment/manifest provider")
        refs = []
        if isinstance(resource, Metric):
            refs = [("resource_ref", resource.resource_ref)]
        elif isinstance(resource, LogDestination):
            refs = [(f"resource_refs.{i}", ref) for i, ref in enumerate(resource.resource_refs)]
        for field, ref in refs:
            if ref.startswith("manifest:"):
                target = names.get(ref.removeprefix("manifest:"))
                if target is None:
                    if not allow_external_manifest_refs:
                        error(index, field, "Reference must resolve to a resource in this manifest")
                elif isinstance(target, (Metric, Alarm, LogDestination)):
                    error(index, field, "Monitored references must identify workload resources")
        if isinstance(resource, Alarm):
            metric = names.get(resource.metric_ref)
            if not isinstance(metric, Metric):
                error(index, "metric_ref", "Reference must resolve to a metric in these resources")
            if isinstance(resource, AwsAlarm):
                if (
                    isinstance(metric, AwsMetric)
                    and resource.period_seconds < 60
                    and metric.storage_resolution_seconds != 1
                ):
                    error(
                        index,
                        "period_seconds",
                        "Sub-minute alarms require a high-resolution metric",
                    )
                for target in resource.notification_target_refs:
                    if region is not None and target.split(":")[3] != region:
                        error(
                            index,
                            "notification_target_refs",
                            "SNS topic region must match manifest region",
                        )
            if isinstance(resource, AzureAlarm):
                if resource.evaluation_frequency_seconds > resource.window_seconds:
                    error(index, "evaluation_frequency_seconds", "Frequency cannot exceed window")
    if errors:
        raise ValidationError.from_exception_data("Monitoring references", errors)


class MonitoringFragment(MonitoringModel):
    provider: Literal["aws", "azure", "gcp"]
    region: str = Field(min_length=3, max_length=32)
    resources: list[MonitoringResource] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def references(self):
        check_resources(
            self.provider,
            self.resources,
            allow_external_manifest_refs=True,
            region=self.region,
        )
        return self
