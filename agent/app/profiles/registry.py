from __future__ import annotations

from collections.abc import Iterable
from types import MappingProxyType
from typing import Protocol

from app.profiles.errors import ProfileNotAvailable, ProfileNotFound
from app.profiles.models import ProfileBundle, ProfileDefinition
from app.prompts.registry import PromptRegistry


class ProfileSelector(Protocol):
    def select_profile(
        self,
        profile_id: str,
        prompt_version: str | None = None,
    ) -> ProfileBundle: ...


class InMemoryProfileSelector:
    """Immutable MVP profile catalog backed by the versioned prompt registry."""

    def __init__(
        self,
        definitions: Iterable[ProfileDefinition],
        prompt_registry: PromptRegistry,
    ) -> None:
        entries: dict[str, ProfileDefinition] = {}
        for definition in definitions:
            if definition.profile_id in entries:
                raise ValueError(f"duplicate agent profile {definition.profile_id!r}")
            entries[definition.profile_id] = definition

        self._definitions = MappingProxyType(entries)
        self._prompt_registry = prompt_registry

    def select_profile(
        self,
        profile_id: str,
        prompt_version: str | None = None,
    ) -> ProfileBundle:
        definition = self._definitions.get(profile_id)
        if definition is None:
            raise ProfileNotFound(f"Agent profile {profile_id!r} was not found")
        if not definition.active:
            raise ProfileNotAvailable(f"Agent profile {profile_id!r} is not available")

        prompt = self._prompt_registry.get_prompt(
            definition.prompt_profile,
            prompt_version,
        )
        return ProfileBundle(
            profile_id=definition.profile_id,
            prompt=prompt,
            llm_config=definition.llm_config,
        )
