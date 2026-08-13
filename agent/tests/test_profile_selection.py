from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

import pytest
from pydantic import ValidationError

from app.profiles.catalog import build_profile_selector
from app.profiles.errors import ProfileNotAvailable, ProfileNotFound
from app.profiles.models import LLMConfig, ProfileDefinition
from app.profiles.registry import InMemoryProfileSelector
from app.prompts.catalog import build_prompt_registry
from app.prompts.errors import VersionNotFound
from app.prompts.models import PromptBundle
from app.prompts.provisioning import PROVISIONING_AGENT_V1, PROVISIONING_AGENT_V1_1
from app.prompts.registry import InMemoryPromptRegistry


def build_bundle(version: str) -> PromptBundle:
    return PromptBundle(
        prompt_id=uuid5(NAMESPACE_URL, f"provisioning_agent:{version}"),
        profile="provisioning_agent",
        version=version,
        content=f"Provisioning prompt {version}",
        tool_allowlist=("get_policy_requirements", "estimate_cost"),
        required_first_calls=("get_policy_requirements",),
        safety_rules=("Never execute infrastructure.",),
        created_at=datetime(2026, 8, 10, tzinfo=UTC),
        author="Provisr",
        changelog=f"Register {version}.",
    )


def provisioning_definition() -> ProfileDefinition:
    return ProfileDefinition(
        profile_id="provisioning",
        prompt_profile="provisioning_agent",
        active=True,
        llm_config=LLMConfig(temperature=0.0, max_tokens=2048),
    )


def test_selects_active_profile_with_exact_prompt_version() -> None:
    selector = build_profile_selector(build_prompt_registry())

    profile = selector.select_profile("provisioning", "1.0.0")

    assert profile.profile_id == "provisioning"
    assert profile.prompt is PROVISIONING_AGENT_V1
    assert profile.system_prompt == PROVISIONING_AGENT_V1.content
    assert profile.allowed_tools == PROVISIONING_AGENT_V1.tool_allowlist
    assert profile.required_first_calls == PROVISIONING_AGENT_V1.required_first_calls
    assert profile.safety_rules == PROVISIONING_AGENT_V1.safety_rules
    assert profile.prompt_version == "1.0.0"
    assert profile.prompt_hash == PROVISIONING_AGENT_V1.content_hash
    assert profile.llm_config.temperature == 0.0
    assert profile.llm_config.max_tokens == 2048


def test_omitted_version_selects_latest_stable_prompt() -> None:
    prompt_registry = InMemoryPromptRegistry(
        [build_bundle("1.9.0"), build_bundle("2.0.0-rc.1"), build_bundle("1.10.0")]
    )
    selector = InMemoryProfileSelector([provisioning_definition()], prompt_registry)

    profile = selector.select_profile("provisioning")

    assert profile.prompt_version == "1.10.0"


def test_unknown_profile_raises_profile_not_found() -> None:
    selector = build_profile_selector(build_prompt_registry())

    with pytest.raises(ProfileNotFound, match="unknown"):
        selector.select_profile("unknown")


@pytest.mark.parametrize("profile_id", ["image_analysis", "policy_assistant"])
def test_inactive_mvp_profile_raises_profile_not_available(profile_id: str) -> None:
    selector = build_profile_selector(build_prompt_registry())

    with pytest.raises(ProfileNotAvailable, match=profile_id):
        selector.select_profile(profile_id)


def test_unknown_prompt_version_preserves_version_error() -> None:
    selector = build_profile_selector(build_prompt_registry())

    with pytest.raises(VersionNotFound, match="9.0.0"):
        selector.select_profile("provisioning", "9.0.0")


def test_duplicate_profile_id_is_rejected() -> None:
    definition = provisioning_definition()

    with pytest.raises(ValueError, match="duplicate agent profile"):
        InMemoryProfileSelector([definition, definition], build_prompt_registry())


def test_profile_configuration_is_strict_and_immutable() -> None:
    with pytest.raises(ValidationError):
        LLMConfig(temperature=2.1, max_tokens=2048)
    with pytest.raises(ValidationError):
        LLMConfig(temperature=0.0, max_tokens=0)

    config = LLMConfig(temperature=0.0, max_tokens=2048)
    with pytest.raises(ValidationError, match="frozen"):
        config.max_tokens = 4096


def test_serialized_profile_contains_orchestration_fields() -> None:
    profile = build_profile_selector(build_prompt_registry()).select_profile("provisioning")

    payload = profile.model_dump(mode="json")

    assert payload["profile_id"] == "provisioning"
    assert payload["system_prompt"] == PROVISIONING_AGENT_V1_1.content
    assert payload["allowed_tools"] == list(PROVISIONING_AGENT_V1_1.tool_allowlist)
    assert payload["required_first_calls"] == list(PROVISIONING_AGENT_V1_1.required_first_calls)
    assert payload["safety_rules"] == list(PROVISIONING_AGENT_V1_1.safety_rules)
    assert payload["prompt_version"] == "1.1.0"
    assert payload["prompt_hash"] == PROVISIONING_AGENT_V1_1.content_hash
