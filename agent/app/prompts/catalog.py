from app.prompts.provisioning import PROVISIONING_AGENT_V1
from app.prompts.registry import InMemoryPromptRegistry


def build_prompt_registry() -> InMemoryPromptRegistry:
    return InMemoryPromptRegistry([PROVISIONING_AGENT_V1])
