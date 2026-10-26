"""Monitoring planning helper — CloudWatch log group and alarm fragments.

Produces a ``CanonicalResource`` of type ``aws_cloudwatch`` with:
- Log group name and retention period.
- Baseline metric alarms (CPU, memory, error rate patterns).
- An assumption when no explicit alarms are defined (baseline defaults applied).
"""

from __future__ import annotations

from app.domain.helpers.specs import AlarmSpec, MonitoringSpec
from app.domain.manifest import (
    CanonicalResource,
    FieldSource,
    ResourceAssumption,
    SecuritySettings,
)

# Baseline alarms added automatically when the spec provides none.
_BASELINE_ALARMS: list[dict[str, object]] = [
    {
        "alarm_name": "high-cpu-utilization",
        "metric_name": "CPUUtilization",
        "namespace": "AWS/EC2",
        "threshold": 80.0,
        "comparison_operator": "GreaterThanThreshold",
        "evaluation_periods": 2,
        "period_seconds": 300,
        "statistic": "Average",
    },
    {
        "alarm_name": "high-memory-utilization",
        "metric_name": "mem_used_percent",
        "namespace": "CWAgent",
        "threshold": 85.0,
        "comparison_operator": "GreaterThanThreshold",
        "evaluation_periods": 2,
        "period_seconds": 300,
        "statistic": "Average",
    },
    {
        "alarm_name": "elevated-error-count",
        "metric_name": "Errors",
        "namespace": "AWS/Lambda",
        "threshold": 5.0,
        "comparison_operator": "GreaterThanThreshold",
        "evaluation_periods": 1,
        "period_seconds": 60,
        "statistic": "Sum",
    },
]


def build_monitoring_fragment(
    spec: MonitoringSpec,
    *,
    tags: dict[str, str] | None = None,
    policy_refs: list[str] | None = None,
) -> CanonicalResource:
    """Build a ``CanonicalResource`` for CloudWatch monitoring.

    Args:
        spec: Validated monitoring specification.
        tags: Tags to attach to the resource.
        policy_refs: Policy constraint IDs that apply to this resource.

    Returns:
        A ``CanonicalResource`` of type ``aws_cloudwatch``.
    """
    assumptions: list[ResourceAssumption] = []

    # Use spec alarms if provided, otherwise apply baseline defaults.
    if spec.alarms:
        alarms_config = _serialize_alarms(spec.alarms)
    else:
        alarms_config = list(_BASELINE_ALARMS)
        assumptions.append(
            ResourceAssumption(
                field="alarms",
                assumed_value="baseline (cpu, memory, errors)",
                confidence=0.80,
                reason=(
                    "No alarms specified; baseline alarms for CPU utilisation (>80%), "
                    "memory (>85%), and error count (>5) have been added. "
                    "Review and adjust thresholds to suit your workload."
                ),
            )
        )

    provider_config: dict[str, object] = {
        "log_group_name": spec.log_group_name,
        "log_retention_days": spec.log_retention_days,
        "alarms": alarms_config,
    }

    return CanonicalResource(
        logical_name=spec.logical_name,
        type="aws_cloudwatch",
        provider_config=provider_config,
        dependencies=list(spec.dependencies),
        tags=tags or {},
        security_settings=SecuritySettings(encryption_enabled=True, public_access=False),
        policy_refs=list(policy_refs or []),
        assumptions=assumptions,
        source_metadata=FieldSource(source="user_prompt", confidence=1.0),
    )


def _serialize_alarms(alarms: list[AlarmSpec]) -> list[dict[str, object]]:
    return [
        {
            "alarm_name": a.alarm_name,
            "metric_name": a.metric_name,
            "namespace": a.namespace,
            "threshold": a.threshold,
            "comparison_operator": a.comparison_operator,
            "evaluation_periods": a.evaluation_periods,
            "period_seconds": a.period_seconds,
            "statistic": a.statistic,
        }
        for a in alarms
    ]
