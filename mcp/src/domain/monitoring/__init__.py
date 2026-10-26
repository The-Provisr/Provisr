"""Monitoring domain tools produce intent only; shared contracts own validation."""

from provisr_contracts.monitoring import MonitoringFragment
from pydantic import BaseModel, Field, ValidationError


class ValidationIssue(BaseModel):
    field: str
    code: str
    message: str


class MonitoringValidationResult(BaseModel):
    valid: bool
    errors: list[ValidationIssue]
    deferred_resource_refs: list[str] = Field(default_factory=list)


class MonitoringGenerationResult(MonitoringValidationResult):
    fragment: MonitoringFragment | None


def validate_monitoring_request(fragment: object) -> dict[str, object]:
    try:
        parsed = MonitoringFragment.model_validate(fragment)
    except ValidationError as exc:
        return {
            "valid": False,
            "errors": [
                {
                    "field": ".".join(map(str, error["loc"])) or "fragment",
                    "code": error["type"],
                    "message": error["msg"],
                }
                for error in exc.errors(include_input=False, include_url=False)
            ],
        }
    deferred = sorted(
        {
            ref
            for resource in parsed.resources
            for ref in (
                [resource.resource_ref]
                if hasattr(resource, "resource_ref")
                else getattr(resource, "resource_refs", [])
            )
            if ref.startswith("manifest:")
        }
    )
    return {"valid": True, "errors": [], "deferred_resource_refs": deferred}


def generate_monitoring_manifest(requirements: object) -> dict[str, object]:
    result = validate_monitoring_request(requirements)
    if not result["valid"]:
        return {**result, "fragment": None}
    # Requirements use the same typed intent as fragments. No settings are inferred.
    fragment = MonitoringFragment.model_validate(requirements).model_dump(mode="json")
    return {**result, "fragment": fragment}
