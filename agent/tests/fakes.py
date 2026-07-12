from app.domain.models import AgentSession, ModelTurnResult


class FakeLanguageModel:
    def __init__(self, result: ModelTurnResult) -> None:
        self.result = result
        self.sessions: list[AgentSession] = []

    async def complete_turn(self, session: AgentSession) -> ModelTurnResult:
        self.sessions.append(session.model_copy(deep=True))
        return self.result
