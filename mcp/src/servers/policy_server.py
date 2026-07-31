from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import asyncpg
from fastapi import FastAPI

from src.context.fastapi import install_context_error_handler
from src.context.membership import MembershipStore, PostgresMembershipStore


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

    return application


app = create_app()
