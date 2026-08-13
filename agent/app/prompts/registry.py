from __future__ import annotations

from collections.abc import Iterable
from types import MappingProxyType
from typing import Protocol
from uuid import UUID

from app.prompts.errors import ProfileNotFound, VersionNotFound
from app.prompts.models import PromptBundle, is_prerelease_version, semantic_version_key


class PromptRegistry(Protocol):
    """Lookup boundary used by agent services through dependency injection."""

    def get_prompt(self, profile: str, version: str | None = None) -> PromptBundle: ...


class InMemoryPromptRegistry:
    """Immutable in-process registry for audited prompt bundles."""

    def __init__(self, bundles: Iterable[PromptBundle]) -> None:
        entries: dict[str, dict[str, PromptBundle]] = {}
        prompt_ids: dict[UUID, tuple[str, str]] = {}

        for bundle in bundles:
            profile_versions = entries.setdefault(bundle.profile, {})
            if bundle.version in profile_versions:
                raise ValueError(
                    f"duplicate prompt bundle for {bundle.profile!r} version {bundle.version!r}"
                )

            existing_identity = prompt_ids.get(bundle.prompt_id)
            identity = (bundle.profile, bundle.version)
            if existing_identity is not None and existing_identity != identity:
                raise ValueError(f"prompt_id {bundle.prompt_id} is already registered")

            profile_versions[bundle.version] = bundle
            prompt_ids[bundle.prompt_id] = identity

        self._entries = MappingProxyType(
            {profile: MappingProxyType(dict(versions)) for profile, versions in entries.items()}
        )

    def get_prompt(self, profile: str, version: str | None = None) -> PromptBundle:
        versions = self._entries.get(profile)
        if versions is None:
            raise ProfileNotFound(f"Prompt profile {profile!r} was not found")

        if version is not None:
            bundle = versions.get(version)
            if bundle is None:
                raise VersionNotFound(f"Prompt profile {profile!r} has no version {version!r}")
            return bundle

        stable_versions = [
            candidate for candidate in versions if not is_prerelease_version(candidate)
        ]
        candidates = stable_versions or list(versions)
        latest_version = max(candidates, key=semantic_version_key)
        return versions[latest_version]
