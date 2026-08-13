from uuid import UUID

from app.profiles.models import ProfileBundle


def render_runtime_system_prompt(profile: ProfileBundle, request_id: UUID) -> str:
    """Add trusted per-run correlation data without mutating the pinned prompt bundle."""

    return (
        f"{profile.system_prompt}\n\n"
        "RUNTIME OUTPUT CONTEXT\n"
        f"request_id: {request_id}\n"
        "Copy this request_id exactly into the output envelope."
    )
