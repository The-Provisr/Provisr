import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.domain.errors import InvalidModelResponseError
from app.domain.models import AgentSession, ConversationMessage
from app.integrations.anthropic_model import ClaudeModel
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
        prompt_id=PROVISIONING_AGENT_V1.prompt_id,
        prompt_profile=PROVISIONING_AGENT_V1.profile,
        prompt_version=PROVISIONING_AGENT_V1.version,
        prompt_hash=PROVISIONING_AGENT_V1.content_hash,
        created_at=now,
        updated_at=now,
        messages=[ConversationMessage(role="user", content="Create a server", created_at=now)],
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
        max_tokens=512,
        client=fake,
    )

    result = await model.complete_turn(session(), PROVISIONING_AGENT_V1)

    assert result.outcome == "needs_clarification"
    assert fake.messages.request is not None
    assert fake.messages.request["model"] == "claude-sonnet-4-5"
    assert fake.messages.request["max_tokens"] == 512
    assert fake.messages.request["system"] == PROVISIONING_AGENT_V1.content


@pytest.mark.anyio
async def test_rejects_unstructured_model_output() -> None:
    model = ClaudeModel(
        api_key="test-key",
        model="claude-sonnet-4-5",
        max_tokens=512,
        client=FakeAnthropicClient("not json"),
    )

    with pytest.raises(InvalidModelResponseError):
        await model.complete_turn(session(), PROVISIONING_AGENT_V1)
