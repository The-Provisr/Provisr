from app.domain.models import AgentSession
from app.profiles.models import ProfileBundle


class FakeLanguageModel:
    def __init__(self, raw_output: str) -> None:
        self.raw_output = raw_output
        self.sessions: list[AgentSession] = []
        self.profiles: list[ProfileBundle] = []

    async def complete_turn(
        self,
        session: AgentSession,
        profile: ProfileBundle,
    ) -> str:
        self.sessions.append(session.model_copy(deep=True))
        self.profiles.append(profile)
        return self.raw_output
