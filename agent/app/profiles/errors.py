from app.domain.errors import DomainError


class ProfileNotFound(DomainError):
    code = "AGENT_PROFILE_NOT_FOUND"


class ProfileNotAvailable(DomainError):
    code = "AGENT_PROFILE_NOT_AVAILABLE"
