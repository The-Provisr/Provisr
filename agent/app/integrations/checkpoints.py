from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class AgentCheckpoint:
    checkpoint_id: str
    thread_id: str
    state: dict[str, Any]
    created_at: datetime


class CheckpointStore(Protocol):
    async def save(self, *, thread_id: str, state: dict[str, Any]) -> AgentCheckpoint: ...

    async def load_latest(self, *, thread_id: str) -> AgentCheckpoint | None: ...


class InMemoryCheckpointStore:
    """Checkpoint adapter for resumable graph state.

    It is deliberately replaceable by a durable store in deployments; no request
    can advance a cancelled or unsupported phase when this store is unavailable.
    """

    def __init__(self) -> None:
        self._records: dict[str, AgentCheckpoint] = {}

    async def save(self, *, thread_id: str, state: dict[str, Any]) -> AgentCheckpoint:
        checkpoint = AgentCheckpoint(str(uuid4()), thread_id, state, datetime.now(UTC))
        self._records[thread_id] = checkpoint
        return checkpoint

    async def load_latest(self, *, thread_id: str) -> AgentCheckpoint | None:
        return self._records.get(thread_id)
