from typing import Annotated, Protocol, cast

from fastapi import Depends, Request

from app.domain.service import AgentService
from app.integrations.state import StateStore


class ResourceContainer(Protocol):
    agent_service: AgentService
    state: StateStore


def get_agent_service(request: Request) -> AgentService:
    resources = cast(ResourceContainer, request.app.state.resources)
    return resources.agent_service


def get_state_store(request: Request) -> StateStore:
    resources = cast(ResourceContainer, request.app.state.resources)
    return resources.state


AgentServiceDependency = Annotated[AgentService, Depends(get_agent_service)]
StateStoreDependency = Annotated[StateStore, Depends(get_state_store)]
