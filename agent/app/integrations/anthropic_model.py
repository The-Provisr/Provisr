from __future__ import annotations

import asyncio
import os
import ssl
from typing import Any, Protocol, cast

import anthropic
import certifi

from app.domain.errors import (
    DependencyUnavailableError,
    InvalidModelResponseError,
    ModelNotConfiguredError,
)
from app.domain.models import AgentSession
from app.outputs.runtime import render_runtime_system_prompt
from app.profiles.models import ProfileBundle


class LanguageModel(Protocol):
    async def complete_turn(
        self,
        session: AgentSession,
        profile: ProfileBundle,
    ) -> str: ...


class MessagesResource(Protocol):
    def create(self, **kwargs: Any) -> Any: ...


class AnthropicClient(Protocol):
    @property
    def messages(self) -> MessagesResource: ...


class ClaudeModel:
    """Calls Claude through the Anthropic SDK targeting Claude Platform on AWS.

    Mirrors svc-agent's anthropic provider: the first-party ``Anthropic`` client
    pointed at the ``aws-external-anthropic`` endpoint with a workspace header and
    a short-lived API key.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "",
        workspace_id: str = "",
        client: AnthropicClient | None = None,
    ) -> None:
        self._model = model
        if client is not None:
            self._client: AnthropicClient = client
        elif api_key:
            http_client = _build_http_client()
            self._client = cast(
                AnthropicClient,
                anthropic.Anthropic(
                    api_key=api_key,
                    base_url=base_url or None,
                    default_headers=(
                        {"anthropic-workspace-id": workspace_id} if workspace_id else None
                    ),
                    http_client=http_client,
                ),
            )
        else:
            self._client = _UnconfiguredClient()

    async def complete_turn(
        self,
        session: AgentSession,
        profile: ProfileBundle,
    ) -> str:
        if not self._model:
            raise ModelNotConfiguredError("Anthropic model ID is not configured")

        messages = [
            {"role": message.role, "content": message.content} for message in session.messages[-20:]
        ]
        try:
            response = await asyncio.to_thread(
                self._client.messages.create,
                model=self._model,
                max_tokens=profile.llm_config.max_tokens,
                temperature=profile.llm_config.temperature,
                system=render_runtime_system_prompt(
                    profile,
                    session.request_id,
                    session.policy_requirements,
                ),
                messages=messages,
            )
        except ModelNotConfiguredError:
            raise
        except anthropic.APIError as error:
            raise DependencyUnavailableError("Anthropic request failed") from error

        return _strip_code_fence(_extract_text(response))


def _build_http_client() -> anthropic.DefaultHttpxClient | None:
    """Return a CA-corrected HTTP client, or ``None`` to use the SDK default.

    httpx blindly loads ``SSL_CERT_FILE`` as its CA bundle and crashes if the path
    is missing — a common leftover from Anaconda's ``conda activate`` on Windows,
    which points it at a non-existent ``cacert.pem``. When that var is set but the
    file is absent, fall back to certifi's bundle. A valid ``SSL_CERT_FILE`` (e.g.
    a corporate proxy CA) is left untouched.
    """
    cert_file = os.environ.get("SSL_CERT_FILE")
    if cert_file and not os.path.isfile(cert_file):
        context = ssl.create_default_context(cafile=certifi.where())
        return anthropic.DefaultHttpxClient(verify=context)
    return None


class _UnconfiguredClient:
    """Placeholder used when no API key is configured, so construction never fails."""

    def __init__(self) -> None:
        self.messages = self

    def create(self, **kwargs: Any) -> Any:
        raise ModelNotConfiguredError("Anthropic API key is not configured")


def _extract_text(response: object) -> str:
    content = getattr(response, "content", None)
    if not isinstance(content, list):
        raise InvalidModelResponseError("Anthropic response had no content")
    parts = [
        block.text
        for block in content
        if getattr(block, "type", None) == "text" and isinstance(getattr(block, "text", None), str)
    ]
    text = "\n".join(parts).strip()
    if not text:
        raise InvalidModelResponseError("Claude returned an empty response")
    return text


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```json") and stripped.endswith("```"):
        return stripped[7:-3].strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        return stripped[3:-3].strip()
    return stripped
