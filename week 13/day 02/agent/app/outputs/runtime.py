import json
from uuid import UUID

from app.domain.models import ExecutionContext
from app.policy.models import PolicyRequirements
from app.profiles.models import ProfileBundle


def render_runtime_system_prompt(
    profile: ProfileBundle,
    request_id: UUID,
    policy_requirements: PolicyRequirements | None,
    execution_context: ExecutionContext | None = None,
) -> str:
    """Add trusted per-run correlation data without mutating the pinned prompt bundle."""

    prompt = (
        f"{profile.system_prompt}\n\n"
        "RUNTIME OUTPUT CONTEXT\n"
        f"request_id: {request_id}\n"
        "Copy this request_id exactly into the output envelope."
    )
    if execution_context is not None:
        context = json.dumps(execution_context.model_dump(mode="json"), sort_keys=True)
        prompt += (
            "\n\nVALIDATED EXECUTION CONTEXT\n" + context + "\n"
            "Use only a provider listed as connected and only regions verified for that "
            "provider. When there is one connected provider, use it. When there are several "
            "and the user has not selected one, ask the user or give an evidence-based "
            "recommendation among those providers. Use default_region when the user has not "
            "specified a region. Reference existing_resources when integrating with them, "
            "do not recreate or duplicate existing resources, and choose non-conflicting "
            "names. Respect reported resource counts and quota limits. Null counts or quotas "
            "mean unknown; never invent available capacity."
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
