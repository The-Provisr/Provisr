package policy

// AggregateDecision reduces a set of rule evaluation results into a single
// decision. Precedence: a deny-class violation blocks outright; otherwise an
// explicit approval requirement (either the requiresApproval flag or an
// approval-class violation) forces REQUIRES_APPROVAL; otherwise a
// warning-class violation yields WARN; otherwise the input is ALLOW. Empty
// input is ALLOW.
func AggregateDecision(violations []Violation, requiresApproval bool) Decision {
	for _, v := range violations {
		if denySeverity(v.Severity) {
			return DecisionDeny
		}
	}
	if requiresApproval {
		return DecisionRequiresApproval
	}
	for _, v := range violations {
		if approvalSeverity(v.Severity) {
			return DecisionRequiresApproval
		}
	}
	for _, v := range violations {
		if warnSeverity(v.Severity) {
			return DecisionWarn
		}
	}
	return DecisionAllow
}