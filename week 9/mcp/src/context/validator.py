from __future__ import annotations

from src.context.errors import InvalidContextError
from src.context.membership import MembershipStore
from src.context.models import MCPContext, is_valid_permission


async def validate_context(
    context: MCPContext,
    *,
    required_permission: str,
    membership_store: MembershipStore,
    require_idempotency_key: bool = False,
) -> MCPContext:
    """Authorize an already parsed envelope before any tool-specific processing."""

    if not is_valid_permission(required_permission):
        raise ValueError("required_permission must use the resource:action format")

    role = await membership_store.get_role(
        user_id=context.user_id,
        workspace_id=context.workspace_id,
    )
    if role is None:
        raise InvalidContextError(
            "User does not belong to the requested workspace",
            request_id=context.request_id,
        )

    if required_permission not in context.permissions:
        raise InvalidContextError(
            f"Context does not grant {required_permission} permission",
            request_id=context.request_id,
        )

    if require_idempotency_key and context.idempotency_key is None:
        raise InvalidContextError(
            "An idempotency key is required for this operation",
            request_id=context.request_id,
        )

    return context
