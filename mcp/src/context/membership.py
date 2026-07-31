from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID

_MEMBERSHIP_QUERY = """
SELECT m.role::text
FROM provisr_identity.memberships AS m
JOIN provisr_identity.workspaces AS w ON w.id = m.workspace_id
WHERE m.user_id = $1
  AND m.workspace_id = $2
  AND w.deleted_at IS NULL
"""


class MembershipStore(Protocol):
    async def get_role(self, *, user_id: UUID, workspace_id: UUID) -> str | None: ...


class QueryExecutor(Protocol):
    async def fetchval(self, query: str, *args: Any) -> Any: ...


class PostgresMembershipStore:
    """MVP membership lookup using the shared PostgreSQL identity schema."""

    def __init__(self, executor: QueryExecutor) -> None:
        self._executor = executor

    async def get_role(self, *, user_id: UUID, workspace_id: UUID) -> str | None:
        role = await self._executor.fetchval(_MEMBERSHIP_QUERY, user_id, workspace_id)
        if role is None:
            return None
        if not isinstance(role, str):
            raise TypeError("membership role returned by PostgreSQL must be a string")
        return role
