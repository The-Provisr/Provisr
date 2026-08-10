from __future__ import annotations

import json
import os
import ssl

import certifi
from google import genai
from google.genai import errors, types
from pydantic import ValidationError

from app.domain.errors import (
    DependencyUnavailableError,
    InvalidModelResponseError,
    ModelNotConfiguredError,
)
from app.domain.models import AgentSession, ModelTurnResult
from app.integrations.anthropic_model import _strip_code_fence
from app.profiles.models import ProfileBundle


class GeminiModel:
    """Calls Google Gemini through the ``google-genai`` SDK.

    Implements the same :class:`~app.integrations.anthropic_model.LanguageModel`
    protocol as :class:`ClaudeModel`, so it is a drop-in replacement selected by
    ``PROVISR_MODEL_PROVIDER=gemini``.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        client: genai.Client | None = None,
    ) -> None:
        self._model = model
        if client is not None:
            self._client: genai.Client | None = client
        elif api_key:
            self._client = genai.Client(api_key=api_key, http_options=_build_http_options())
        else:
            self._client = None

    async def complete_turn(
        self,
        session: AgentSession,
        profile: ProfileBundle,
    ) -> ModelTurnResult:
        if not self._model:
            raise ModelNotConfiguredError("Gemini model ID is not configured")
        if self._client is None:
            raise ModelNotConfiguredError("Gemini API key is not configured")

        contents = [
            types.Content(
                role="model" if message.role == "assistant" else "user",
                parts=[types.Part(text=message.content)],
            )
            for message in session.messages[-20:]
        ]
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=profile.system_prompt,
                    max_output_tokens=profile.llm_config.max_tokens,
                    response_mime_type="application/json",
                    temperature=profile.llm_config.temperature,
                ),
            )
        except errors.APIError as error:
            raise DependencyUnavailableError("Gemini request failed") from error

        text = (response.text or "").strip()
        if not text:
            raise InvalidModelResponseError("Gemini returned an empty response")

        try:
            payload = json.loads(_strip_code_fence(text))
            result = ModelTurnResult.model_validate(payload)
        except (json.JSONDecodeError, ValidationError) as error:
            raise InvalidModelResponseError("Gemini returned an invalid agent result") from error

        if result.outcome == "manifest_candidate" and result.manifest is None:
            raise InvalidModelResponseError("Manifest candidate did not contain a manifest")
        if result.outcome == "needs_clarification" and result.manifest is not None:
            raise InvalidModelResponseError(
                "Clarification result unexpectedly contained a manifest"
            )
        return result


def _build_http_options() -> types.HttpOptions | None:
    """Return CA-corrected HTTP options, or ``None`` to use the SDK default.

    Like ``anthropic_model._build_http_client``, this guards against a leftover
    ``SSL_CERT_FILE`` (common after Anaconda's ``conda activate`` on Windows) that
    points at a missing bundle. google-genai loads that path unconditionally and
    crashes at client construction, so fall back to certifi when it is absent.
    """
    cert_file = os.environ.get("SSL_CERT_FILE")
    if cert_file and not os.path.isfile(cert_file):
        ctx = ssl.create_default_context(cafile=certifi.where())
        # httpx keys the SSL context under "verify"; aiohttp (websockets) uses "ssl".
        return types.HttpOptions(
            client_args={"verify": ctx},
            async_client_args={"verify": ctx, "ssl": ctx},
        )
    return None
