import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.domain.errors import InvalidModelResponseError
from app.domain.models import AgentSession, ConversationMessage
from app.integrations.anthropic_model import ClaudeModel
from app.profiles.catalog import build_profile_selector
from app.profiles.models import ProfileBundle
from app.prompts.catalog import build_prompt_registry
from app.prompts.provisioning import PROVISIONING_AGENT_V1


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
        request_id="req-1",
        profile_id="provisioning",
        prompt_id=PROVISIONING_AGENT_V1.prompt_id,
        prompt_profile=PROVISIONING_AGENT_V1.profile,
        prompt_version=PROVISIONING_AGENT_V1.version,
        prompt_hash=PROVISIONING_AGENT_V1.content_hash,
        temperature=0.0,
        max_tokens=2048,
        created_at=now,
        updated_at=now,
        messages=[ConversationMessage(role="user", content="Create a server", created_at=now)],
    )


def provisioning_profile() -> ProfileBundle:
    return build_profile_selector(build_prompt_registry()).select_profile(
        "provisioning",
        "1.0.0",
    )


@pytest.mark.anyio
async def test_messages_create_result_is_validated() -> None:
    fake = FakeAnthropicClient(
        json.dumps(
            {
                "outcome": "needs_clarification",
                "message": "Which AWS region should I use?",
                "manifest": None,
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

    assert result.outcome == "needs_clarification"
    assert fake.messages.request is not None
    assert fake.messages.request["model"] == "claude-sonnet-4-5"
    assert fake.messages.request["max_tokens"] == 2048
    assert fake.messages.request["temperature"] == 0.0
    assert fake.messages.request["system"] == PROVISIONING_AGENT_V1.content


@pytest.mark.anyio
async def test_rejects_unstructured_model_output() -> None:
    model = ClaudeModel(
        api_key="test-key",
        model="claude-sonnet-4-5",
        client=FakeAnthropicClient("not json"),
    )

    with pytest.raises(InvalidModelResponseError):
        await model.complete_turn(session(), provisioning_profile())
