import pytest

from app.policy.explanation import explain_policy_violation


@pytest.mark.parametrize("hint", ["Set data['limits']['max'] to 10.", "Use input[\"resource\"].", "Change data .limit.", "input.resources[0]"])
def test_policy_references_do_not_reach_user_remediation(hint):
    result = explain_policy_violation(rule_key="unknown", severity="high", evidence={}, remediation_hint=hint)
    assert result["remediation"] == "Adjust the affected setting to meet your workspace policy."


@pytest.mark.parametrize("severity,label", [("high", "High severity:"), ("unknown", "Policy check failed:")])
def test_severity_label_has_only_one_separator(severity, label):
    result = explain_policy_violation(rule_key="unknown", severity=severity, evidence={}, remediation_hint="")
    assert result["explanation"].startswith(label)
    assert ".:" not in result["explanation"]
