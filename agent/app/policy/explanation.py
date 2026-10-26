"""Turn structured policy decisions into concise, user-safe explanations."""

from __future__ import annotations

import re
from collections.abc import Mapping

_RULES: dict[str, tuple[str, str]] = {
    "s3_public_access": (
        ("The request would make an S3 bucket publicly accessible, which conflicts with "
         "your organization's security policy."),
        "Keep public access blocked, or use an approved private access pattern.",
    ),
    "public_access": (
        ("The request would expose a resource to the public, which conflicts with "
         "your organization's security policy."),
        "Restrict access to the intended users or networks.",
    ),
    "encryption_required": (
        "The request does not enable encryption required by your organization's policy.",
        "Enable encryption for the affected resource.",
    ),
    "allowed_regions": (
        "The requested region is outside the locations allowed by your organization's policy.",
        "Choose an approved region for this workspace.",
    ),
    "max_budget": (
        "The estimated monthly cost is above the budget limit set for this workspace.",
        "Choose lower-cost resources or reduce capacity to fit the workspace budget.",
    ),
    "required_tags": (
        "The request is missing tags required by your organization's policy.",
        "Add the required workspace tags to the affected resource.",
    ),
    "required_backup": (
        "The request does not enable backups required by your organization's policy.",
        "Enable backups and set an appropriate retention period.",
    ),
}
_SAFE_PATH = re.compile(r"^[A-Za-z0-9_.$\[\]-]{1,160}$")
_INTERNAL_MARKERS = re.compile(
    r"\b(rego|opa|input(?=\s*[.\[])|data(?=\s*[.\[])|package\s+[\w.]+|rule_key|policy\s+id)\b"
    r"|:=|==|!=|<=|>=|[{};]|\bdeny\b|\ballow\b",
    re.IGNORECASE,
)


def explain_policy_violation(
    *,
    rule_key: str,
    severity: str,
    evidence: Mapping[str, object],
    remediation_hint: str,
) -> dict[str, str]:
    """Return a plain-language explanation without forwarding policy internals."""

    key = _normalize_rule_key(rule_key)
    explanation, default_remediation = _RULES.get(key, _generic_explanation())
    path = _manifest_path(evidence)
    affected = f"The affected manifest field is `{path}`." if path else (
        "The violation is in the proposed manifest."
    )
    severity_label = _severity_label(severity)
    safe_remediation = _safe_remediation(remediation_hint) or default_remediation
    return {
        "explanation": f"{severity_label}: {explanation}",
        "manifest_part": affected,
        "remediation": safe_remediation,
    }


def _normalize_rule_key(value: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", value.lower()).strip("_")[:128]


def _generic_explanation() -> tuple[str, str]:
    return (
        "The request does not meet a requirement in your workspace policy.",
        "Adjust the affected setting to meet your workspace policy.",
    )


def _severity_label(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"critical", "high", "medium", "low", "warning", "error"}:
        return f"{normalized.capitalize()} severity"
    return "Policy check failed"


def _manifest_path(evidence: Mapping[str, object]) -> str | None:
    for key in ("manifest_path", "field_path", "path", "field"):
        value = evidence.get(key)
        if isinstance(value, str) and _SAFE_PATH.fullmatch(value):
            return value
    return None


def _safe_remediation(value: str) -> str | None:
    text = " ".join(value.split())[:500]
    if not text or _INTERNAL_MARKERS.search(text):
        return None
    return text
