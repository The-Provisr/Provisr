from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

import pytest
from pydantic import ValidationError

from app.prompts import (
    InMemoryPromptRegistry,
    ProfileNotFound,
    PromptBundle,
    VersionNotFound,
)


def build_bundle(
    version: str,
    *,
    profile: str = "provisioning_agent",
    content: str | None = None,
) -> PromptBundle:
    return PromptBundle(
        prompt_id=uuid5(NAMESPACE_URL, f"{profile}:{version}"),
        profile=profile,
        version=version,
        content=content or f"Provisioning prompt version {version}",
        tool_allowlist=("get_policy_requirements", "create_manifest"),
        required_first_calls=("get_policy_requirements",),
        safety_rules=("Never execute infrastructure.", "Never bypass policy."),
        created_at=datetime(2026, 7, 31, 9, 0, tzinfo=UTC),
        author="Provisr",
        changelog=f"Register {version}.",
    )


def test_returns_exact_prompt_for_valid_profile_and_version() -> None:
    first = build_bundle("1.0.0")
    second = build_bundle("1.1.0")
    registry = InMemoryPromptRegistry([first, second])

    result = registry.get_prompt("provisioning_agent", "1.0.0")

    assert result is first
    assert result.version == "1.0.0"


def test_keeps_versions_separate_across_profiles() -> None:
    provisioning = build_bundle("1.0.0")
    policy = build_bundle("1.0.0", profile="policy_assistant")
    registry = InMemoryPromptRegistry([provisioning, policy])

    assert registry.get_prompt("provisioning_agent", "1.0.0") is provisioning
    assert registry.get_prompt("policy_assistant", "1.0.0") is policy


def test_returns_latest_stable_prompt_when_version_is_omitted() -> None:
    registry = InMemoryPromptRegistry(
        [
            build_bundle("1.9.0"),
            build_bundle("2.0.0-rc.1"),
            build_bundle("1.10.0"),
        ]
    )

    result = registry.get_prompt("provisioning_agent")

    assert result.version == "1.10.0"


def test_returns_latest_prerelease_when_no_stable_version_exists() -> None:
    registry = InMemoryPromptRegistry(
        [
            build_bundle("2.0.0-alpha.2"),
            build_bundle("2.0.0-alpha.10"),
            build_bundle("2.0.0-rc.1"),
        ]
    )

    result = registry.get_prompt("provisioning_agent")

    assert result.version == "2.0.0-rc.1"


def test_raises_profile_not_found_for_unknown_profile() -> None:
    registry = InMemoryPromptRegistry([build_bundle("1.0.0")])

    with pytest.raises(ProfileNotFound, match="image_analysis_agent"):
        registry.get_prompt("image_analysis_agent")


def test_raises_version_not_found_for_unknown_version() -> None:
    registry = InMemoryPromptRegistry([build_bundle("1.0.0")])

    with pytest.raises(VersionNotFound, match="9.0.0"):
        registry.get_prompt("provisioning_agent", "9.0.0")


def test_hash_is_deterministic_and_covers_the_complete_bundle() -> None:
    first = build_bundle("1.0.0")
    second = build_bundle("1.0.0")
    changed_content = build_bundle("1.0.0", content="Changed instructions")

    changed_rules_payload = first.model_dump(mode="json")
    changed_rules_payload["safety_rules"] = ["Different safety rule"]

    assert first.content_hash == second.content_hash
    assert first.content_hash != changed_content.content_hash
    with pytest.raises(ValidationError, match="content_hash does not match"):
        PromptBundle.model_validate(changed_rules_payload)


def test_rejects_required_first_call_outside_allowlist() -> None:
    payload = build_bundle("1.0.0").model_dump(mode="json", exclude={"content_hash"})
    payload["required_first_calls"] = ["unknown_tool"]

    with pytest.raises(ValidationError, match="included in tool_allowlist"):
        PromptBundle.model_validate(payload)


def test_rejects_invalid_semantic_version() -> None:
    payload = build_bundle("1.0.0").model_dump(mode="json", exclude={"content_hash"})
    payload["version"] = "version-one"

    with pytest.raises(ValidationError, match="semantic version"):
        PromptBundle.model_validate(payload)


def test_rejects_duplicate_profile_version() -> None:
    bundle = build_bundle("1.0.0")

    with pytest.raises(ValueError, match="duplicate prompt bundle"):
        InMemoryPromptRegistry([bundle, bundle])


def test_registered_bundle_is_immutable() -> None:
    bundle = build_bundle("1.0.0")

    with pytest.raises(ValidationError, match="frozen"):
        bundle.content = "Tampered instructions"
