from app.domain.models import AgentSession
from app.policy.errors import PolicyRequirementsUnavailableError
from app.policy.models import PolicyRequirements
from app.profiles.models import ProfileBundle


class FakeLanguageModel:
    def __init__(self, raw_output: str, order: list[str] | None = None) -> None:
        self.raw_output = raw_output
        self.order = order
        self.sessions: list[AgentSession] = []
        self.profiles: list[ProfileBundle] = []

    async def complete_turn(
        self,
        session: AgentSession,
        profile: ProfileBundle,
    ) -> str:
        self.sessions.append(session.model_copy(deep=True))
        self.profiles.append(profile)
        if self.order is not None:
            self.order.append("model")
        return self.raw_output


class FakePolicyRequirementsTool:
    def __init__(
        self,
        requirements: PolicyRequirements | None = None,
        *,
        error: PolicyRequirementsUnavailableError | None = None,
        order: list[str] | None = None,
    ) -> None:
        self.requirements = requirements or PolicyRequirements(
            allowed_regions=("ap-southeast-1",),
        )
        self.error = error
        self.order = order
        self.sessions: list[AgentSession] = []

    async def get_policy_requirements(self, session: AgentSession) -> PolicyRequirements:
        self.sessions.append(session.model_copy(deep=True))
        if self.order is not None:
            self.order.append("policy")
        if self.error is not None:
            raise self.error
        return self.requirements
