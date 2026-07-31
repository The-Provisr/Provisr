from app.domain.errors import DomainError


class ProfileNotFound(DomainError):
    code = "PROMPT_PROFILE_NOT_FOUND"


class VersionNotFound(DomainError):
    code = "PROMPT_VERSION_NOT_FOUND"
