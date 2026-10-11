import json
from uuid import UUID

from app.policy.models import PolicyRequirements
from app.profiles.models import ProfileBundle


def render_runtime_system_prompt(
    profile: ProfileBundle,
    request_id: UUID,
    policy_requirements: PolicyRequirements | None,
) -> str:
    """Add trusted per-run correlation data without mutating the pinned prompt bundle."""

    prompt = (
        f"{profile.system_prompt}\n\n"
        "RUNTIME OUTPUT CONTEXT\n"
        f"request_id: {request_id}\n"
        "Copy this request_id exactly into the output envelope."
    )
    if policy_requirements is None:
        return prompt

    serialized_requirements = json.dumps(
        policy_requirements.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    return (
        f"{prompt}\n\n"
        "AUTHORITATIVE POLICY REQUIREMENTS\n"
        f"{serialized_requirements}\n"
        "Apply every enabled constraint to any manifest draft. If the user's request "
        "conflicts with these requirements, do not draft a conflicting manifest. Explain "
        "the constraint in plain language, suggest compliant alternatives, and ask the user "
        "to confirm one of those alternatives with a clarification_question envelope."
    )
