from app.profiles.models import LLMConfig, ProfileDefinition
from app.profiles.registry import InMemoryProfileSelector
from app.prompts.registry import PromptRegistry

_DEFAULT_LLM_CONFIG = LLMConfig(temperature=0.0, max_tokens=2048)

PROFILE_DEFINITIONS = (
    ProfileDefinition(
        profile_id="provisioning",
        prompt_profile="provisioning_agent",
        active=True,
        llm_config=_DEFAULT_LLM_CONFIG,
    ),
    ProfileDefinition(
        profile_id="image_analysis",
        prompt_profile="image_analysis_agent",
        active=False,
        llm_config=_DEFAULT_LLM_CONFIG,
    ),
    ProfileDefinition(
        profile_id="policy_assistant",
        prompt_profile="policy_assistant",
        active=False,
        llm_config=_DEFAULT_LLM_CONFIG,
    ),
)


def build_profile_selector(prompt_registry: PromptRegistry) -> InMemoryProfileSelector:
    return InMemoryProfileSelector(PROFILE_DEFINITIONS, prompt_registry)
