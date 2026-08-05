from app.domain.models import AgentSession, ModelTurnResult
from app.prompts.models import PromptBundle


class FakeLanguageModel:
    def __init__(self, result: ModelTurnResult) -> None:
        self.result = result
        self.sessions: list[AgentSession] = []
        self.prompts: list[PromptBundle] = []

    async def complete_turn(
        self,
        session: AgentSession,
        prompt: PromptBundle,
    ) -> ModelTurnResult:
        self.sessions.append(session.model_copy(deep=True))
        self.prompts.append(prompt)
        return self.result
