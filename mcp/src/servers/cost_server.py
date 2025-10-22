"""MCP-017 cost estimation tool backed by the provider pricing service."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol, cast
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, PositiveInt, model_validator

from src.context.fastapi import require_context
from src.context.models import MCPContext

router = APIRouter()

HOURS_PER_MONTH = 730.0


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ManifestReference(StrictModel):
    run_id: UUID
    version: PositiveInt | Literal["latest"] = "latest"


class PlanReference(StrictModel):
    run_id: UUID
    plan_id: UUID | Literal["latest"] = "latest"


class EstimateCostRequest(StrictModel):
    context: MCPContext
    manifest: dict[str, Any] | None = None
    plan: dict[str, Any] | None = None
    manifest_reference: ManifestReference | None = None
    plan_reference: PlanReference | None = None
    currency: str = Field(default="USD", min_length=3, max_length=3, pattern=r"^[A-Za-z]{3}$")

    @model_validator(mode="after")
    def require_one_source(self) -> EstimateCostRequest:
        sources = (self.manifest, self.plan, self.manifest_reference, self.plan_reference)
        if sum(source is not None for source in sources) != 1:
            raise ValueError(
                "exactly one of manifest, plan, manifest_reference, or plan_reference is required"
            )
        return self


class FreshnessMetadata(StrictModel):
    fetched_at: datetime
    expires_at: datetime
    stale: bool
    warning: str | None = None


class PricingResponse(StrictModel):
    provider: str
    service: str
    region: str
    tier: str
    unit: str
    price_per_unit: float = Field(ge=0)
    currency: str
    effective_date: datetime
    freshness_metadata: FreshnessMetadata


class CostResources(Protocol):
    http_client: httpx.AsyncClient
    manifest_url: str
    plan_url: str
    pricing_url: str


@dataclass(frozen=True, slots=True)
class PricingLookup:
    resource_id: str
    resource_type: str
    request: dict[str, Any]
    quantity: float
    assumptions: tuple[str, ...]
    confidence: float


@router.post("/tools/estimate_cost")
async def estimate_cost(
    request: Request,
    body: EstimateCostRequest,
    context: MCPContext = Depends(require_context("cost:read")),  # noqa: B008
) -> dict[str, Any]:
    """Resolve infrastructure input, obtain unit prices, and aggregate monthly cost."""
    resources = cast(CostResources, request.app.state.resources)
    document, source = await _resolve_document(body, context, resources)
    lookups, global_assumptions = _build_lookups(document, source, body.currency.upper())
    if not lookups:
        raise HTTPException(
            status_code=422,
            detail="The referenced infrastructure contains no priceable resources",
        )

    headers = {
        "Content-Type": "application/json",
        "X-Request-ID": str(context.request_id),
        "X-Correlation-ID": str(context.correlation_id),
    }
    breakdown = await asyncio.gather(
        *(_price_resource(resources, lookup, headers) for lookup in lookups)
    )

    currencies = {item["currency"] for item in breakdown}
    if len(currencies) != 1:
        raise HTTPException(status_code=502, detail="Pricing service returned mixed currencies")

    total = round(sum(cast(float, item["monthly_estimate"]) for item in breakdown), 6)
    assumptions = list(dict.fromkeys([
        *global_assumptions,
        *(assumption for item in breakdown for assumption in item["pricing_assumptions"]),
    ]))
    confidence = round(min(cast(float, item["confidence"]) for item in breakdown), 2)
    freshness_items = [cast(dict[str, Any], item["freshness"]) for item in breakdown]
    warnings = list(dict.fromkeys(
        warning
        for item in freshness_items
        if isinstance((warning := item.get("warning")), str) and warning
    ))

    return {
        "monthly_estimate": total,
        "currency": currencies.pop(),
        "resource_breakdown": breakdown,
        "pricing_assumptions": assumptions,
        "confidence": confidence,
        "freshness": {
            "stale": any(bool(item["stale"]) for item in freshness_items),
            "oldest_fetched_at": min(str(item["fetched_at"]) for item in freshness_items),
            "earliest_expires_at": min(str(item["expires_at"]) for item in freshness_items),
            "warnings": warnings,
        },
        "source": source,
    }


async def _resolve_document(
    body: EstimateCostRequest,
    context: MCPContext,
    resources: CostResources,
) -> tuple[dict[str, Any], Literal["manifest", "plan"]]:
    if body.manifest is not None:
        return body.manifest, "manifest"
    if body.plan is not None:
        return body.plan, "plan"

    headers = {
        "X-Request-ID": str(context.request_id),
        "X-Correlation-ID": str(context.correlation_id),
    }
    if body.manifest_reference is not None:
        reference = body.manifest_reference
        _require_current_run(reference.run_id, context)
        version = str(reference.version)
        url = (
            f"{resources.manifest_url.rstrip('/')}/v1/runs/"
            f"{quote(str(reference.run_id), safe='')}/manifests/{quote(version, safe='')}"
        )
        payload = await _fetch_reference(resources.http_client, url, headers, "manifest")
        return _unwrap_document(payload, "manifest"), "manifest"

    reference = cast(PlanReference, body.plan_reference)
    _require_current_run(reference.run_id, context)
    plan_id = str(reference.plan_id)
    url = (
        f"{resources.plan_url.rstrip('/')}/v1/runs/"
        f"{quote(str(reference.run_id), safe='')}/plans/{quote(plan_id, safe='')}"
    )
    payload = await _fetch_reference(resources.http_client, url, headers, "plan")
    return _unwrap_document(payload, "plan"), "plan"


def _require_current_run(run_id: UUID, context: MCPContext) -> None:
    if run_id != context.request_id:
        raise HTTPException(
            status_code=403,
            detail="Artifact reference must belong to the current provisioning run",
        )


async def _fetch_reference(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    kind: str,
) -> dict[str, Any]:
    try:
        response = await client.get(url, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"{kind.title()} service is unavailable") from exc
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Referenced {kind} was not found")
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"{kind.title()} service returned an error")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"{kind.title()} service returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail=f"{kind.title()} service returned an invalid record")
    return payload


def _unwrap_document(payload: dict[str, Any], kind: str) -> dict[str, Any]:
    for key in ("content", kind):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return payload


async def _price_resource(
    resources: CostResources,
    lookup: PricingLookup,
    headers: dict[str, str],
) -> dict[str, Any]:
    try:
        response = await resources.http_client.post(
            f"{resources.pricing_url.rstrip('/')}/v1/pricing/lookup",
            json=lookup.request,
            headers=headers,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Pricing service is unavailable") from exc
    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Pricing lookup failed for resource {lookup.resource_id}",
        )
    try:
        price = PricingResponse.model_validate(response.json())
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Pricing service returned an invalid price") from exc

    monthly = round(price.price_per_unit * lookup.quantity, 6)
    return {
        "resource_id": lookup.resource_id,
        "resource_type": lookup.resource_type,
        "provider": price.provider,
        "service": price.service,
        "region": price.region,
        "tier": price.tier,
        "unit": price.unit,
        "quantity": lookup.quantity,
        "price_per_unit": price.price_per_unit,
        "monthly_estimate": monthly,
        "currency": price.currency,
        "effective_date": price.effective_date.isoformat(),
        "pricing_assumptions": list(lookup.assumptions),
        "confidence": lookup.confidence,
        "freshness": price.freshness_metadata.model_dump(mode="json"),
    }


def _build_lookups(
    document: dict[str, Any],
    source: Literal["manifest", "plan"],
    currency: str,
) -> tuple[list[PricingLookup], list[str]]:
    if source == "manifest":
        raw_resources = document.get("resources")
        provider = _string(document.get("provider"))
        region = _string(document.get("region"))
    else:
        raw_resources = document.get("resource_changes", document.get("resources"))
        provider = _string(document.get("provider"))
        region = _string(document.get("region"))
    if not isinstance(raw_resources, list):
        raise HTTPException(status_code=422, detail=f"{source} resources must be a list")

    lookups: list[PricingLookup] = []
    skipped: list[str] = []
    for index, raw in enumerate(raw_resources):
        normalized = _normalize_resource(raw, index, source)
        if normalized is None:
            skipped.append(f"Skipped malformed resource at index {index}.")
            continue
        lookup = _lookup_for_resource(normalized, provider, region, currency)
        if lookup is None:
            skipped.append(
                f"No pricing mapping is available for resource {normalized['resource_id']} "
                f"({normalized['resource_type']})."
            )
            continue
        lookups.append(lookup)
    return lookups, skipped


def _normalize_resource(
    raw: object,
    index: int,
    source: Literal["manifest", "plan"],
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    resource_type = _string(raw.get("type"))
    resource_id = _string(raw.get("logical_name") or raw.get("name") or raw.get("address"))
    properties: dict[str, Any] = {}
    for key in ("properties", "provider_config"):
        value = raw.get(key)
        if isinstance(value, dict):
            properties.update(value)
    if source == "plan":
        change = raw.get("change")
        if isinstance(change, dict) and isinstance(change.get("after"), dict):
            properties.update(cast(dict[str, Any], change["after"]))
    pricing = raw.get("pricing", properties.get("pricing"))
    return {
        "resource_id": resource_id or f"resource_{index}",
        "resource_type": resource_type,
        "provider": _string(raw.get("provider")),
        "region": _string(raw.get("region")),
        "properties": properties,
        "pricing": pricing if isinstance(pricing, dict) else {},
    }


def _lookup_for_resource(
    resource: dict[str, Any],
    document_provider: str,
    document_region: str,
    currency: str,
) -> PricingLookup | None:
    resource_type = cast(str, resource["resource_type"])
    properties = cast(dict[str, Any], resource["properties"])
    explicit = cast(dict[str, Any], resource["pricing"])
    provider = (
        _string(explicit.get("provider"))
        or cast(str, resource["provider"])
        or document_provider
        or _provider_from_type(resource_type)
    ).lower()
    region = _string(explicit.get("region")) or cast(str, resource["region"]) or document_region
    mapping = _default_mapping(provider, resource_type, properties)

    service = _string(explicit.get("service")) or mapping.get("service", "")
    tier = _string(explicit.get("tier")) or mapping.get("tier", "")
    unit = _string(explicit.get("unit")) or mapping.get("unit", "")
    filters = explicit.get("filters", mapping.get("filters", {}))
    mode = _string(explicit.get("mode")) or "on_demand"
    if not provider or not region or not service or (not tier and not filters):
        return None
    if not isinstance(filters, dict) or any(
        not isinstance(key, str) or not isinstance(value, str) for key, value in filters.items()
    ):
        return None

    assumptions: list[str] = []
    quantity = _number(explicit.get("monthly_quantity"))
    confidence = 1.0
    if quantity is None:
        quantity, quantity_assumptions, confidence = _monthly_quantity(unit, properties)
        assumptions.extend(quantity_assumptions)
    if quantity < 0:
        return None

    request = {
        "provider": provider,
        "service": service,
        "region": region,
        "tier": tier,
        "unit": unit,
        "currency": currency,
        "mode": mode,
        "filters": filters,
    }
    return PricingLookup(
        resource_id=cast(str, resource["resource_id"]),
        resource_type=resource_type,
        request=request,
        quantity=quantity,
        assumptions=tuple(assumptions),
        confidence=confidence,
    )


def _default_mapping(provider: str, resource_type: str, properties: dict[str, Any]) -> dict[str, Any]:
    kind = resource_type.lower().replace(".", "_")
    if provider == "aws":
        if kind in {"aws_ec2", "compute_aws_ec2", "aws_instance"}:
            return {
                "service": "AmazonEC2",
                "tier": _string(properties.get("instance_type")),
                "unit": "Hrs",
                "filters": {"operatingSystem": _string(properties.get("operating_system")) or "Linux"},
            }
        if kind in {"aws_rds", "database_aws_rds", "aws_db_instance"}:
            return {
                "service": "AmazonRDS",
                "tier": _string(properties.get("instance_class")),
                "unit": "Hrs",
                "filters": {"databaseEngine": _string(properties.get("engine")) or "PostgreSQL"},
            }
        if kind in {"aws_ecs_service", "container_aws_ecs"}:
            return {
                "service": "AmazonECS",
                "tier": _string(properties.get("launch_type")) or "FARGATE",
                "unit": "Hrs",
                "filters": {},
            }
        if kind in {"aws_s3", "storage_aws_s3", "aws_s3_bucket"}:
            return {
                "service": "AmazonS3",
                "tier": _string(properties.get("storage_class")) or "Standard",
                "unit": "GB-Mo",
                "filters": {},
            }
    return {}


def _monthly_quantity(unit: str, properties: dict[str, Any]) -> tuple[float, list[str], float]:
    normalized = unit.lower()
    count = _number(properties.get("count") or properties.get("desired_count"))
    if count is None:
        count = 1.0
    if normalized in {"hrs", "hour", "hours", "1 hour"}:
        hours = _number(properties.get("hours_per_month"))
        assumptions: list[str] = []
        confidence = 1.0
        if hours is None:
            hours = HOURS_PER_MONTH
            assumptions.append("Assumed 730 running hours per month for an always-on resource.")
            confidence = 0.9
        if "count" not in properties and "desired_count" not in properties:
            assumptions.append("Assumed one resource instance because no count was provided.")
            confidence = min(confidence, 0.85)
        return hours * count, assumptions, confidence
    if normalized in {"gb-mo", "gb/month", "gb month", "gib-month"}:
        storage = _number(
            properties.get("storage_gb")
            or properties.get("allocated_storage_gb")
            or properties.get("size_gb")
        )
        if storage is None:
            return 1.0, ["Assumed 1 GB-month because storage usage was not provided."], 0.6
        return storage * count, [], 0.95
    quantity = _number(properties.get("monthly_quantity"))
    if quantity is not None:
        return quantity, [], 0.95
    return count, [f"Assumed one monthly pricing unit ({unit or 'unit'}) per resource."], 0.5


def _provider_from_type(resource_type: str) -> str:
    normalized = resource_type.lower().replace(".", "_")
    for provider in ("aws", "azure", "gcp"):
        if normalized.startswith(provider + "_") or f"_{provider}_" in normalized:
            return provider
    return ""


def _string(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)
