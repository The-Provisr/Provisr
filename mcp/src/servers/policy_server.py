from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import asyncpg
import httpx
from fastapi import Depends, FastAPI, HTTPException, Request

from src.context.fastapi import install_context_error_handler, require_context
from src.context.membership import MembershipStore, PostgresMembershipStore
from src.context.models import MCPContext


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
            or os.getenv("BACKEND_URL", "http://localhost:8081")
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

    return application


app = create_app()
