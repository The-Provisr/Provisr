class DomainError(Exception):
    code = "DOMAIN_ERROR"


class SessionNotFoundError(DomainError):
    code = "SESSION_NOT_FOUND"


class SessionFailedError(DomainError):
    code = "SESSION_FAILED"


class InvalidModelResponseError(DomainError):
    code = "INVALID_MODEL_RESPONSE"


class ModelNotConfiguredError(DomainError):
    code = "MODEL_NOT_CONFIGURED"


class DependencyUnavailableError(DomainError):
    code = "DEPENDENCY_UNAVAILABLE"


class DispatchRunMismatchError(DomainError):
    code = "DISPATCH_RUN_MISMATCH"


class PhaseNotConfiguredError(DomainError):
    code = "PHASE_NOT_CONFIGURED"
