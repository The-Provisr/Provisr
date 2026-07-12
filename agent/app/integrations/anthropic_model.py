from __future__ import annotations

import asyncio
import json
import os
import ssl
from typing import Any, Protocol, cast

import anthropic
import certifi
from pydantic import ValidationError

from app.domain.errors import (
    DependencyUnavailableError,
    InvalidModelResponseError,
    ModelNotConfiguredError,
)
from app.domain.models import AgentSession, ModelTurnResult


class LanguageModel(Protocol):
    async def complete_turn(self, session: AgentSession) -> ModelTurnResult: ...


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
        max_tokens: int,
        base_url: str = "",
        workspace_id: str = "",
        client: AnthropicClient | None = None,
    ) -> None:
        self._model = model
        self._max_tokens = max_tokens
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

    async def complete_turn(self, session: AgentSession) -> ModelTurnResult:
        if not self._model:
            raise ModelNotConfiguredError("Anthropic model ID is not configured")

        messages = [
            {"role": message.role, "content": message.content} for message in session.messages[-20:]
        ]
        try:
            response = await asyncio.to_thread(
                self._client.messages.create,
                model=self._model,
                max_tokens=self._max_tokens,
                system=_SYSTEM_PROMPT,
                messages=messages,
            )
        except ModelNotConfiguredError:
            raise
        except anthropic.APIError as error:
            raise DependencyUnavailableError("Anthropic request failed") from error

        text = _extract_text(response)
        try:
            payload = json.loads(_strip_code_fence(text))
            result = ModelTurnResult.model_validate(payload)
        except (json.JSONDecodeError, ValidationError) as error:
            raise InvalidModelResponseError("Claude returned an invalid agent result") from error

        if result.outcome == "manifest_candidate" and result.manifest is None:
            raise InvalidModelResponseError("Manifest candidate did not contain a manifest")
        if result.outcome == "needs_clarification" and result.manifest is not None:
            raise InvalidModelResponseError(
                "Clarification result unexpectedly contained a manifest"
            )
        return result


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


_SYSTEM_PROMPT = """You are the Provisr manifest planning assistant.
You may clarify infrastructure intent and propose an AWS ResourceManifest.
You do not approve requests, run Terraform, claim deployment success, or expose private reasoning.
Return exactly one JSON object and no markdown.

For a clarification:
{"outcome":"needs_clarification","message":"one focused question","manifest":null}

For a complete proposal:
{"outcome":"manifest_candidate","message":"short user-safe summary","manifest":{...}}

The manifest object has exactly these fields:
  "schema_version": "1.0"
  "provider": "aws"
  "region": a valid AWS region string, e.g. "us-east-1"
  "environment": one of "development", "staging", "production", "sandbox"
  "monthly_budget_usd": a positive number, or omit if unknown
  "tags": an object mapping string keys to string values (may be empty {})
  "resources": a non-empty array of resource objects

Each resource object uses exactly the fields for its type and no others:
  aws_ec2 fields: type="aws_ec2", name (slug), instance_type (string),
    image (AMI id string), count (int 1-20, default 1)
  aws_rds fields: type="aws_rds", name (slug), engine ("postgres" or "mysql"),
    instance_class (string), allocated_storage_gb (int 20-16384)
  aws_s3 fields: type="aws_s3", name (lowercase bucket name 3-63 chars),
    versioning (bool)

"name" for ec2/rds matches ^[a-zA-Z0-9_-]+$. Use the exact field names above; do not
rename them (for example the EC2 AMI field is "image", never "ami").
Never invent a missing requirement when it materially affects security, cost, region, or capacity.
"""
