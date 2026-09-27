// Package policy contains the core policy decision logic shared by the
// policy-service and its consumers: the decision vocabulary and decision
// aggregation. Rego evaluation itself is owned by the policy-service epic
// (BE-C04); this package is the testable, evaluator-independent core.
package policy

// Decision is the outcome of a policy evaluation. Values mirror
// PolicyDecision in packages/proto/provisr/v1/policy.proto.
type Decision string

const (
	DecisionAllow            Decision = "ALLOW"
	DecisionWarn             Decision = "WARN"
	DecisionDeny             Decision = "DENY"
	DecisionRequiresApproval Decision = "REQUIRES_APPROVAL"
	DecisionWaived           Decision = "WAIVED"
)

// Violation severities. Evaluators map rule severities onto these classes so
// aggregation can stay evaluator-agnostic.
const (
	SeverityDeny     = "deny"
	SeverityApproval = "approval"
	SeverityWarn     = "warn"
)

// Violation describes a single rule evaluation that flagged the input.
type Violation struct {
	RuleKey         string
	Severity        string
	Description     string
	Evidence        string
	RemediationHint string
}

// denySeverity reports whether a severity class blocks execution outright.
// Evaluators may express blocking rules as deny/critical/high.
func denySeverity(severity string) bool {
	return severity == SeverityDeny || severity == "critical" || severity == "high"
}

// approvalSeverity reports whether a severity class forces the approval flow.
func approvalSeverity(severity string) bool {
	return severity == SeverityApproval
}

// warnSeverity reports whether a severity class is non-blocking but worth
// surfacing. Unknown severities are ignored by aggregation.
func warnSeverity(severity string) bool {
	return severity == SeverityWarn || severity == "medium" || severity == "low"
}