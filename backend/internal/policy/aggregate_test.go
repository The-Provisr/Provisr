package policy

import "testing"

func TestAggregateDecision(t *testing.T) {
	deny := Violation{RuleKey: "r1", Severity: SeverityDeny}
	critical := Violation{RuleKey: "r2", Severity: "critical"}
	high := Violation{RuleKey: "r3", Severity: "high"}
	approval := Violation{RuleKey: "r4", Severity: SeverityApproval}
	warn := Violation{RuleKey: "r5", Severity: SeverityWarn}
	medium := Violation{RuleKey: "r6", Severity: "medium"}
	low := Violation{RuleKey: "r7", Severity: "low"}
	unknown := Violation{RuleKey: "r8", Severity: "something-else"}

	tests := []struct {
		name             string
		violations       []Violation
		requiresApproval bool
		want             Decision
	}{
		{"empty input", nil, false, DecisionAllow},
		{"no violations", []Violation{}, false, DecisionAllow},
		{"deny blocks", []Violation{deny}, false, DecisionDeny},
		{"critical blocks", []Violation{critical}, false, DecisionDeny},
		{"high blocks", []Violation{high}, false, DecisionDeny},
		{"deny outranks approval", []Violation{deny, approval}, false, DecisionDeny},
		{"deny outranks warns", []Violation{warn, deny, low}, false, DecisionDeny},
		{"approval violation", []Violation{approval}, false, DecisionRequiresApproval},
		{"approval outranks warn", []Violation{warn, approval}, false, DecisionRequiresApproval},
		{"requiresApproval flag", []Violation{warn}, true, DecisionRequiresApproval},
		{"flag plus deny still denies", []Violation{deny}, true, DecisionDeny},
		{"warn surfaces warning", []Violation{warn}, false, DecisionWarn},
		{"medium surfaces warning", []Violation{medium}, false, DecisionWarn},
		{"low surfaces warning", []Violation{low}, false, DecisionWarn},
		{"multiple warns", []Violation{warn, medium, low}, false, DecisionWarn},
		{"unknown severity is ignored", []Violation{unknown}, false, DecisionAllow},
		{"mixed unknown and warn", []Violation{unknown, warn}, false, DecisionWarn},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := AggregateDecision(tt.violations, tt.requiresApproval); got != tt.want {
				t.Fatalf("AggregateDecision(%v, %v) = %q, want %q", tt.violations, tt.requiresApproval, got, tt.want)
			}
		})
	}
}

func TestSeverityClassifiers(t *testing.T) {
	for _, s := range []string{"deny", "critical", "high"} {
		if !denySeverity(s) {
			t.Fatalf("denySeverity(%q) = false, want true", s)
		}
		if denial := denySeverity(s); denial && s == "warn" {
			t.Fatal("warn must not classify as deny")
		}
	}
	if denySeverity("warn") || denySeverity("") || denySeverity("info") {
		t.Fatal("non-deny severities must not classify as deny")
	}
	if !approvalSeverity("approval") {
		t.Fatal("approvalSeverity(approval) = false")
	}
	if approvalSeverity("deny") || approvalSeverity("warn") {
		t.Fatal("only approval classifies as approval")
	}
	for _, s := range []string{"warn", "medium", "low"} {
		if !warnSeverity(s) {
			t.Fatalf("warnSeverity(%q) = false, want true", s)
		}
	}
	if warnSeverity("deny") || warnSeverity("critical") || warnSeverity("approval") || warnSeverity("") {
		t.Fatal("high-severity and unknown classes must not classify as warn")
	}
}