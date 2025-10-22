from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class InvalidContextResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: Literal["invalid_context"] = "invalid_context"
    message: str
    request_id: UUID | None


class InvalidContextError(Exception):
    def __init__(self, message: str, request_id: UUID | None = None) -> None:
        super().__init__(message)
        self.request_id = request_id

    def as_response(self) -> InvalidContextResponse:
        return InvalidContextResponse(message=str(self), request_id=self.request_id)
