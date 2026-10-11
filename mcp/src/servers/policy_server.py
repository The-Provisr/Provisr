from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import asyncpg
import httpx
from fastapi import Depends, FastAPI, HTTPException, Request

from src.context.fastapi import install_context_error_handler, require_context
from src.context.membership import MembershipStore, PostgresMembershipStore
from src.context.models import MCPContext

logger = logging.getLogger(__name__)

_CHECK_TYPES = ("manifest", "plan")
_DECISIONS = frozenset({"ALLOW", "WARN", "DENY", "REQUIRES_APPROVAL"})
_VIOLATION_FIELDS = ("rule_key", "severity", "description", "evidence", "remediation_hint")
_EVALUATE_TIMEOUT_SECONDS = 5.0


@dataclass(slots=True)
class Resources:
    membership_store: MembershipStore
    http_client: httpx.AsyncClient
    backend_url: str


def create_app(
    membership_store: MembershipStore | None = None,
    http_client: httpx.AsyncClient | None = None,
    backend_url: str | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        pool: asyncpg.Pool | None = None
        resolved_store = membership_store
        if resolved_store is None:
            pool = await asyncpg.create_pool(
                dsn=os.getenv(
                    "DATABASE_URL",
                    "postgres://localhost:5432/provisr?sslmode=disable",
                ),
                min_size=1,
                max_size=5,
                command_timeout=5,
            )
            resolved_store = PostgresMembershipStore(pool)

        client = http_client or httpx.AsyncClient()
        resolved_backend_url = (
            backend_url
            or os.getenv("POLICY_SERVICE_URL")
            or os.getenv("BACKEND_URL", "http://policy-service:8081")
        ).rstrip("/")

        application.state.resources = Resources(
            membership_store=resolved_store,
            http_client=client,
            backend_url=resolved_backend_url,
        )
        try:
            yield
        finally:
            if http_client is None:
                await client.aclose()
            if pool is not None:
                await pool.close()

    application = FastAPI(
        title="Provisr MCP - Policy Server",
        lifespan=lifespan,
    )
    install_context_error_handler(application)

    @application.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/health/ready")
    async def ready() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/tools/get_policy_requirements")
    async def get_policy_requirements(
        request: Request,
        context: MCPContext = Depends(require_context("policy:read")),  # noqa: B008
    ) -> dict[str, Any]:
        resources: Resources = request.app.state.resources

        headers = {
            "X-Request-ID": str(context.request_id),
            "X-Correlation-ID": str(context.correlation_id),
        }
        url = f"{resources.backend_url}/v1/workspaces/{context.workspace_id}/policy-requirements"
        try:
            response = await resources.http_client.get(url, headers=headers)
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to connect to backend policy service: {exc}",
            ) from exc

        if response.status_code != 200:
            status_code = 502 if response.status_code >= 500 else response.status_code
            raise HTTPException(
                status_code=status_code,
                detail=f"Backend policy service returned error: {response.text}",
            )

        data = response.json()
        if isinstance(data, dict):
            # Normalize fields for cross-layer compatibility (BE-C03 <-> MCP-003 <-> AG-008)
            if "max_monthly_budget_usd" in data and "max_budget" not in data:
                data["max_budget"] = data["max_monthly_budget_usd"]
            if "enabled" not in data:
                data["enabled"] = bool(data.get("has_policies", True))

        return data

    @application.post("/tools/check_policy")
    async def check_policy(
        request: Request,
        context: MCPContext = Depends(require_context("policy:read")),  # noqa: B008
    ) -> dict[str, Any]:
        resources: Resources = request.app.state.resources

        body = await request.json()
        check_type = body.get("check_type")
        payload = body.get("payload")
        if not isinstance(check_type, str) or check_type not in _CHECK_TYPES:
            raise _check_policy_error(
                422,
                "invalid_check_type",
                "check_type must be one of: manifest, plan",
                context,
            )
        if not isinstance(payload, dict):
            raise _check_policy_error(
                422,
                "invalid_payload",
                "payload must be a JSON object",
                context,
            )

        headers = {
            "X-Request-ID": str(context.request_id),
            "X-Correlation-ID": str(context.correlation_id),
        }
        url = f"{resources.backend_url}/v1/policies/evaluate"
        try:
            response = await resources.http_client.post(
                url,
                json={
                    "workspace_id": str(context.workspace_id),
                    "check_type": check_type,
                    "input": payload,
                },
                headers=headers,
                timeout=_EVALUATE_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as exc:
            raise _check_policy_error(
                504,
                "policy_service_timeout",
                "Backend policy service timed out",
                context,
            ) from exc
        except httpx.RequestError as exc:
            raise _check_policy_error(
                502,
                "policy_service_unavailable",
                "Failed to connect to backend policy service",
                context,
            ) from exc

        if response.status_code != 200:
            raise _check_policy_error(
                502,
                "policy_service_error",
                f"Backend policy service returned status {response.status_code}",
                context,
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise _check_policy_error(
                502,
                "policy_service_malformed_response",
                "Backend policy service returned a malformed response",
                context,
            ) from exc

        violations = _parse_violations(data)
        if violations is None:
            raise _check_policy_error(
                502,
                "policy_service_malformed_response",
                "Backend policy service returned a malformed response",
                context,
            )

        decision = data.get("decision")
        if not isinstance(decision, str) or decision not in _DECISIONS:
            raise _check_policy_error(
                502,
                "policy_decision_unrecognised",
                "Backend policy service returned an unrecognised decision",
                context,
            )

        evaluated_at = data.get("evaluated_at")
        if not isinstance(evaluated_at, str) or not evaluated_at:
            evaluated_at = datetime.now(UTC).isoformat()

        logger.info(
            "check_policy decision=%s rule_keys=%s check_type=%s workspace_id=%s correlation_id=%s",
            decision,
            sorted({violation["rule_key"] for violation in violations}),
            check_type,
            context.workspace_id,
            context.correlation_id,
        )

        return {
            "decision": decision,
            "violations": violations,
            "evaluated_at": evaluated_at,
        }

    return application


def _check_policy_error(
    status_code: int,
    code: str,
    message: str,
    context: MCPContext,
) -> HTTPException:
    logger.warning(
        "check_policy failed error=%s workspace_id=%s correlation_id=%s",
        code,
        context.workspace_id,
        context.correlation_id,
    )
    return HTTPException(
        status_code=status_code,
        detail={
            "error": code,
            "message": message,
            "correlation_id": str(context.correlation_id),
        },
    )


def _parse_violations(data: Any) -> list[dict[str, str]] | None:
    """Return the violations of an evaluation response, or None if it is malformed."""

    if not isinstance(data, dict):
        return None
    raw_violations = data.get("violations")
    if raw_violations is None:
        # The Go policy service encodes "no violations" as null.
        return []
    if not isinstance(raw_violations, list):
        return None

    violations: list[dict[str, str]] = []
    for raw in raw_violations:
        if not isinstance(raw, dict):
            return None
        if any(not isinstance(raw.get(field), str) for field in _VIOLATION_FIELDS):
            return None
        violations.append({field: raw[field] for field in _VIOLATION_FIELDS})
    return violations


app = create_app()
