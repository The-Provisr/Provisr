class DomainError(Exception):
    code = "DOMAIN_ERROR"


class SessionNotFoundError(DomainError):
    code = "SESSION_NOT_FOUND"


class InvalidModelResponseError(DomainError):
    code = "INVALID_MODEL_RESPONSE"


class ModelNotConfiguredError(DomainError):
    code = "MODEL_NOT_CONFIGURED"


class DependencyUnavailableError(DomainError):
    code = "DEPENDENCY_UNAVAILABLE"
