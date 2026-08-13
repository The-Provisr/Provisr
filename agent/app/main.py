from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.api.errors import register_error_handlers
from app.api.routes import router
from app.config.settings import Settings, load_settings
from app.domain.service import AgentService
from app.integrations.anthropic_model import ClaudeModel, LanguageModel
from app.integrations.gemini_model import GeminiModel
from app.integrations.state import InMemoryStateStore, RedisStateStore, StateStore
from app.profiles.catalog import build_profile_selector
from app.profiles.registry import ProfileSelector
from app.prompts.catalog import build_prompt_registry
from app.prompts.registry import PromptRegistry


@dataclass(slots=True)
class Resources:
    state: StateStore
    prompt_registry: PromptRegistry
    profile_selector: ProfileSelector
    agent_service: AgentService

    async def aclose(self) -> None:
        await self.state.aclose()


def create_resources(
    settings: Settings,
    model: LanguageModel | None = None,
    prompt_registry: PromptRegistry | None = None,
    profile_selector: ProfileSelector | None = None,
) -> Resources:
    if settings.state_backend == "redis":
        redis = Redis.from_url(settings.redis_url, decode_responses=True)
        state: StateStore = RedisStateStore(redis, settings.session_ttl_seconds)
    else:
        state = InMemoryStateStore()

    language_model = model or _build_model(settings)
    resolved_prompt_registry = prompt_registry or build_prompt_registry()
    resolved_profile_selector = profile_selector or build_profile_selector(resolved_prompt_registry)
    return Resources(
        state=state,
        prompt_registry=resolved_prompt_registry,
        profile_selector=resolved_profile_selector,
        agent_service=AgentService(
            state=state,
            model=language_model,
            profile_selector=resolved_profile_selector,
        ),
    )


def _build_model(settings: Settings) -> LanguageModel:
    if settings.model_provider == "gemini":
        return GeminiModel(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
        )
    return ClaudeModel(
        api_key=settings.anthropic_api_key,
        model=settings.anthropic_model,
        base_url=settings.anthropic_base_url,
        workspace_id=settings.anthropic_workspace_id,
    )


def create_app(
    *,
    settings: Settings | None = None,
    resources: Resources | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        resolved_resources = resources or create_resources(resolved_settings)
        app.state.resources = resolved_resources
        try:
            yield
        finally:
            await resolved_resources.aclose()

    application = FastAPI(
        title="Provisr Agent API",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(application)
    application.include_router(router)
    return application


app = create_app()
