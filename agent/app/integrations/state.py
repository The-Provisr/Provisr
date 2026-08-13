from __future__ import annotations

from typing import Protocol

from redis.asyncio import Redis

from app.domain.errors import SessionNotFoundError
from app.domain.models import AgentEvent, AgentSession


class StateStore(Protocol):
    async def save_session(self, session: AgentSession) -> None: ...

    async def get_session(self, session_id: str) -> AgentSession: ...

    async def append_event(self, event: AgentEvent) -> None: ...

    async def list_events(self, session_id: str, after_sequence: int) -> list[AgentEvent]: ...

    async def ready(self) -> bool: ...

    async def aclose(self) -> None: ...


class InMemoryStateStore:
    def __init__(self) -> None:
        self._sessions: dict[str, AgentSession] = {}
        self._events: dict[str, list[AgentEvent]] = {}

    async def save_session(self, session: AgentSession) -> None:
        self._sessions[session.session_id] = session.model_copy(deep=True)

    async def get_session(self, session_id: str) -> AgentSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError("Agent session was not found")
        return session.model_copy(deep=True)

    async def append_event(self, event: AgentEvent) -> None:
        self._events.setdefault(event.session_id, []).append(event.model_copy(deep=True))

    async def list_events(self, session_id: str, after_sequence: int) -> list[AgentEvent]:
        await self.get_session(session_id)
        return [
            event.model_copy(deep=True)
            for event in self._events.get(session_id, [])
            if event.sequence > after_sequence
        ]

    async def ready(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None


class RedisStateStore:
    def __init__(self, client: Redis, ttl_seconds: int) -> None:
        self._client = client
        self._ttl_seconds = ttl_seconds

    def _session_key(self, session_id: str) -> str:
        return f"provisr:agent:session:{session_id}"

    def _events_key(self, session_id: str) -> str:
        return f"provisr:agent:events:{session_id}"

    async def save_session(self, session: AgentSession) -> None:
        await self._client.set(
            self._session_key(session.session_id),
            session.model_dump_json(),
            ex=self._ttl_seconds,
        )

    async def get_session(self, session_id: str) -> AgentSession:
        raw = await self._client.get(self._session_key(session_id))
        if raw is None:
            raise SessionNotFoundError("Agent session was not found")
        return AgentSession.model_validate_json(raw)

    async def append_event(self, event: AgentEvent) -> None:
        key = self._events_key(event.session_id)
        async with self._client.pipeline(transaction=True) as pipeline:
            pipeline.rpush(key, event.model_dump_json())
            pipeline.expire(key, self._ttl_seconds)
            await pipeline.execute()

    async def list_events(self, session_id: str, after_sequence: int) -> list[AgentEvent]:
        await self.get_session(session_id)
        records = await self._client.lrange(  # type: ignore[misc]  # redis sync/async union
            self._events_key(session_id), 0, -1
        )
        events = [AgentEvent.model_validate_json(record) for record in records]
        return [event for event in events if event.sequence > after_sequence]

    async def ready(self) -> bool:
        return bool(await self._client.ping())

    async def aclose(self) -> None:
        await self._client.aclose()
