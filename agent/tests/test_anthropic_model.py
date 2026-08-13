import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.domain.models import AgentSession, ConversationMessage
from app.integrations.anthropic_model import ClaudeModel
from app.profiles.catalog import build_profile_selector
from app.profiles.models import ProfileBundle
from app.prompts.catalog import build_prompt_registry
from app.prompts.provisioning import PROVISIONING_AGENT_V1_1

REQUEST_ID = "8b8c64dc-6607-4a45-aa71-f51b2d381cdf"


class FakeMessages:
    def __init__(self, text: str) -> None:
        self._text = text
        self.request: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> Any:
        self.request = kwargs
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=self._text)])


class FakeAnthropicClient:
    def __init__(self, text: str) -> None:
        self.messages = FakeMessages(text)


def session() -> AgentSession:
    now = datetime.now(UTC)
    return AgentSession(
        session_id="session-1",
        organization_id="org-1",
        request_id=REQUEST_ID,
        profile_id="provisioning",
        prompt_id=PROVISIONING_AGENT_V1_1.prompt_id,
        prompt_profile=PROVISIONING_AGENT_V1_1.profile,
        prompt_version=PROVISIONING_AGENT_V1_1.version,
        prompt_hash=PROVISIONING_AGENT_V1_1.content_hash,
        temperature=0.0,
        max_tokens=2048,
        created_at=now,
        updated_at=now,
        messages=[ConversationMessage(role="user", content="Create a server", created_at=now)],
    )


def provisioning_profile() -> ProfileBundle:
    return build_profile_selector(build_prompt_registry()).select_profile(
        "provisioning",
        "1.1.0",
    )


@pytest.mark.anyio
async def test_messages_create_result_is_validated() -> None:
    fake = FakeAnthropicClient(
        json.dumps(
            {
                "type": "clarification_question",
                "version": "1.0.0",
                "request_id": REQUEST_ID,
                "data": {"question": "Which AWS region should I use?"},
                "metadata": {
                    "confidence": 1.0,
                    "source": "llm_generated",
                    "warnings": [],
                },
            }
        )
    )
    model = ClaudeModel(
        api_key="test-key",
        model="claude-sonnet-4-5",
        client=fake,
    )

    profile = provisioning_profile()
    result = await model.complete_turn(session(), profile)

    assert json.loads(result)["type"] == "clarification_question"
    assert fake.messages.request is not None
    assert fake.messages.request["model"] == "claude-sonnet-4-5"
    assert fake.messages.request["max_tokens"] == 2048
    assert fake.messages.request["temperature"] == 0.0
    assert fake.messages.request["system"].startswith(PROVISIONING_AGENT_V1_1.content)
    assert f"request_id: {REQUEST_ID}" in fake.messages.request["system"]


@pytest.mark.anyio
async def test_returns_untrusted_text_for_central_validation() -> None:
    model = ClaudeModel(
        api_key="test-key",
        model="claude-sonnet-4-5",
        client=FakeAnthropicClient("not json"),
    )

    result = await model.complete_turn(session(), provisioning_profile())

    assert result == "not json"
