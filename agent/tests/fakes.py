from app.domain.models import AgentSession, ModelTurnResult
from app.profiles.models import ProfileBundle


class FakeLanguageModel:
    def __init__(self, result: ModelTurnResult) -> None:
        self.result = result
        self.sessions: list[AgentSession] = []
        self.profiles: list[ProfileBundle] = []

    async def complete_turn(
        self,
        session: AgentSession,
        profile: ProfileBundle,
    ) -> ModelTurnResult:
        self.sessions.append(session.model_copy(deep=True))
        self.profiles.append(profile)
        return self.result
