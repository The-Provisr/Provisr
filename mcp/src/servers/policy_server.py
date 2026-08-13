from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import asyncpg
import httpx
from fastapi import Depends, FastAPI

from src.context.fastapi import install_context_error_handler, require_context
from src.context.membership import MembershipStore, PostgresMembershipStore
from src.context.models import MCPContext


@dataclass(slots=True)
class Resources:
    membership_store: MembershipStore


def create_app(membership_store: MembershipStore | None = None) -> FastAPI:
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

        application.state.resources = Resources(membership_store=resolved_store)
        try:
            yield
        finally:
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
        _: dict[str, object],
        context: MCPContext = Depends(require_context("policy:read")),
    ) -> dict[str, object]:
        """MCP-003: retrieve requirements from the backend policy authority."""
        policy_url = os.getenv("POLICY_SERVICE_URL", "http://localhost:8081")
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{policy_url.rstrip('/')}/workspaces/{context.workspace_id}/policy-requirements"
            )
            response.raise_for_status()
        return {
            "ok": True,
            "tool": "get_policy_requirements",
            "result": response.json(),
        }

    return application


app = create_app()
