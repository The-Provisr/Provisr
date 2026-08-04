from pydantic import BaseModel, ConfigDict, Field

from app.domain.models import AgentSession, ModelTurnResult


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateSessionRequest(ApiModel):
    organization_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    prompt_version: str | None = Field(default=None, min_length=1, max_length=64)


class CreateSessionResponse(ApiModel):
    session: AgentSession


class RunTurnRequest(ApiModel):
    message: str = Field(min_length=1, max_length=20000)


class RunTurnResponse(ApiModel):
    result: ModelTurnResult


class ProblemDetails(ApiModel):
    type: str
    title: str
    status: int
    detail: str
    code: str
