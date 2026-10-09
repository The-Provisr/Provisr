from app.domain.errors import DomainError


class PolicyRequirementsUnavailableError(DomainError):
    code = "POLICY_REQUIREMENTS_UNAVAILABLE"
