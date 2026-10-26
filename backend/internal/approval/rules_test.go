package approval

import (
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/provisr/backend/internal/policy"
)

func cost(v float64) *float64 { return &v }

// baseline triggers no rule: dev, cheap, engineer, ALLOW, harmless create.
func baseline() RunContext {
	return RunContext{
		WorkspaceID:          "11111111-1111-1111-1111-111111111111",
		UserID:               "22222222-2222-2222-2222-222222222222",
		Environment:          "dev",
		Provider:             "aws",
		Region:               "us-east-1",
		ResourceChanges:      []ResourceChange{{Address: "aws_s3_bucket.logs", Type: "aws_s3_bucket", Action: "create"}},
		CostEstimate:         CostEstimate{EstimatedMonthlyUSD: cost(40)},
		Policy:               PolicyResult{Decision: policy.DecisionAllow},
		UserRole:             "engineer",
		WorkspaceEnvironment: "dev",
	}
}

func mustEvaluate(t *testing.T, in RunContext, cfg Config) Requirement {
	t.Helper()
	got, err := Evaluate(in, cfg)
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}
	return got
}

func TestEvaluateNoRulesMatched(t *testing.T) {
	got := mustEvaluate(t, baseline(), DefaultConfig())
	if got.RequiresApproval || got.RequiredApproverRole != nil || got.RiskLevel != RiskLow {
		t.Fatalf("expected no approval, got %+v", got)
	}
	if got.Reason != "no approval rules matched" || len(got.TriggeredRules) != 0 {
		t.Fatalf("unexpected reason/rules: %+v", got)
	}
	if got.RuleSetVersion != RuleSetVersion || got.CostSource != CostSourceManifestEstimate || len(got.InputDigest) != 64 {
		t.Fatalf("missing provenance: %+v", got)
	}
}

func TestEvaluateSingleRules(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(*RunContext)
		cfg      Config
		rule     string
		approver ApproverRole
		risk     RiskLevel
		reason   string
	}{
		{
			name:   "production run",
			mutate: func(in *RunContext) { in.Environment = "production" },
			rule:   RuleEnvironment, approver: ApproverAdmin, risk: RiskHigh, reason: "production environment",
		},
		{
			name:   "production workspace overrides dev input",
			mutate: func(in *RunContext) { in.WorkspaceEnvironment = "prod" },
			rule:   RuleEnvironment, approver: ApproverAdmin, risk: RiskHigh, reason: "production environment",
		},
		{
			name:   "cost above default threshold",
			mutate: func(in *RunContext) { in.CostEstimate.EstimatedMonthlyUSD = cost(500.01) },
			rule:   RuleCost, approver: ApproverFinance, risk: RiskMedium, reason: "$500.01/month exceeds $500.00",
		},
		{
			name:   "cost at 5x threshold is high",
			mutate: func(in *RunContext) { in.CostEstimate.EstimatedMonthlyUSD = cost(2500) },
			rule:   RuleCost, approver: ApproverFinance, risk: RiskHigh, reason: "$2500.00/month",
		},
		{
			name:   "custom threshold",
			mutate: func(in *RunContext) {},
			cfg:    Config{CostThresholdUSD: 10},
			rule:   RuleCost, approver: ApproverFinance, risk: RiskMedium, reason: "exceeds $10.00",
		},
		{
			name: "database deletion",
			mutate: func(in *RunContext) {
				in.UserRole = "admin"
				in.ResourceChanges = []ResourceChange{{Address: "aws_db_instance.main", Type: "aws_db_instance", Action: "delete"}}
			},
			rule: RuleResourceType, approver: ApproverAdmin, risk: RiskCritical, reason: "database deletion requires admin approval: aws_db_instance.main",
		},
		{
			name: "manifest database replace",
			mutate: func(in *RunContext) {
				in.UserRole = "admin"
				in.ResourceChanges = []ResourceChange{{Address: "orders", Type: "database.gcp.cloudsql", Action: "replace"}}
			},
			rule: RuleResourceType, approver: ApproverAdmin, risk: RiskCritical, reason: "database deletion",
		},
		{
			name: "IAM change",
			mutate: func(in *RunContext) {
				in.ResourceChanges = []ResourceChange{{Address: "aws_iam_role.app", Type: "aws_iam_role", Action: "update"}}
			},
			rule: RuleResourceType, approver: ApproverSecurity, risk: RiskHigh, reason: "IAM changes require security approval: aws_iam_role.app",
		},
		{
			name: "aws security group open ingress",
			mutate: func(in *RunContext) {
				in.ResourceChanges = []ResourceChange{{Address: "aws_security_group.web", Type: "aws_security_group", Action: "create",
					Properties: map[string]any{"ingress": []any{map[string]any{"from_port": 22.0, "cidr_blocks": []any{"0.0.0.0/0"}}}}}}
			},
			rule: RuleResourceType, approver: ApproverSecurity, risk: RiskHigh, reason: "security group open to the internet",
		},
		{
			name: "gcp firewall open source range",
			mutate: func(in *RunContext) {
				in.ResourceChanges = []ResourceChange{{Address: "google_compute_firewall.ssh", Type: "google_compute_firewall", Action: "create",
					Properties: map[string]any{"direction": "INGRESS", "source_ranges": []any{"::/0"}}}}
			},
			rule: RuleResourceType, approver: ApproverSecurity, risk: RiskHigh, reason: "google_compute_firewall.ssh",
		},
		{
			name: "azure nsg rule from Internet",
			mutate: func(in *RunContext) {
				in.ResourceChanges = []ResourceChange{{Address: "azurerm_network_security_rule.rdp", Type: "azurerm_network_security_rule", Action: "create",
					Properties: map[string]any{"direction": "Inbound", "access": "Allow", "source_address_prefix": "Internet"}}}
			},
			rule: RuleResourceType, approver: ApproverSecurity, risk: RiskHigh, reason: "azurerm_network_security_rule.rdp",
		},
		{
			name: "public resource",
			mutate: func(in *RunContext) {
				in.ResourceChanges = []ResourceChange{{Address: "aws_lb.public", Type: "aws_lb", Action: "create", Public: true}}
			},
			rule: RulePublicExposure, approver: ApproverSecurity, risk: RiskHigh, reason: "public internet exposure requires security approval: aws_lb.public",
		},
		{
			name:   "public exposure flag",
			mutate: func(in *RunContext) { in.PublicExposure = true },
			rule:   RulePublicExposure, approver: ApproverSecurity, risk: RiskHigh, reason: "public internet exposure",
		},
		{
			name: "policy requires approval",
			mutate: func(in *RunContext) {
				in.Policy = PolicyResult{Decision: policy.DecisionRequiresApproval, Violations: []policy.Violation{
					{RuleKey: "security.instance_size", Severity: policy.SeverityApproval},
					{RuleKey: "compliance.required_tags", Severity: policy.SeverityWarn},
				}}
			},
			rule: RulePolicyViolation, approver: ApproverSecurity, risk: RiskMedium, reason: "policy decision requires approval: security.instance_size",
		},
		{
			name: "approval-class violation without aggregated decision",
			mutate: func(in *RunContext) {
				in.Policy = PolicyResult{Decision: policy.DecisionWarn, Violations: []policy.Violation{{RuleKey: "cost.burst", Severity: policy.SeverityApproval}}}
			},
			rule: RulePolicyViolation, approver: ApproverSecurity, risk: RiskMedium, reason: "cost.burst",
		},
		{
			name: "engineer destructive change",
			mutate: func(in *RunContext) {
				in.ResourceChanges = []ResourceChange{{Address: "aws_s3_bucket.logs", Type: "aws_s3_bucket", Action: "delete"}}
			},
			rule: RuleRole, approver: ApproverAdmin, risk: RiskMedium, reason: `destructive changes by role "engineer"`,
		},
		{
			name:   "viewer any change",
			mutate: func(in *RunContext) { in.UserRole = "viewer" },
			rule:   RuleRole, approver: ApproverAdmin, risk: RiskMedium, reason: `role "viewer" cannot provision`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := baseline()
			tt.mutate(&in)
			cfg := tt.cfg
			if cfg == (Config{}) {
				cfg = DefaultConfig()
			}
			got := mustEvaluate(t, in, cfg)
			if !got.RequiresApproval || len(got.TriggeredRules) != 1 {
				t.Fatalf("expected exactly one triggered rule, got %+v", got.TriggeredRules)
			}
			r := got.TriggeredRules[0]
			if r.Rule != tt.rule || r.ApproverRole != tt.approver || r.RiskLevel != tt.risk {
				t.Fatalf("got rule %+v", r)
			}
			if got.RiskLevel != tt.risk || got.RequiredApproverRole == nil || *got.RequiredApproverRole != tt.approver {
				t.Fatalf("aggregate mismatch: %+v", got)
			}
			if !strings.Contains(got.Reason, tt.reason) {
				t.Fatalf("reason %q does not contain %q", got.Reason, tt.reason)
			}
		})
	}
}

func TestEvaluateIgnoresSafeChanges(t *testing.T) {
	tests := []struct {
		name   string
		change ResourceChange
	}{
		{"egress open", ResourceChange{Address: "aws_security_group.app", Type: "aws_security_group", Action: "create",
			Properties: map[string]any{"egress": []any{map[string]any{"cidr_blocks": []any{"0.0.0.0/0"}}}}}},
		{"egress rule resource", ResourceChange{Address: "aws_security_group_rule.out", Type: "aws_security_group_rule", Action: "create",
			Properties: map[string]any{"type": "egress", "cidr_blocks": []any{"0.0.0.0/0"}}}},
		{"private ingress", ResourceChange{Address: "aws_security_group.db", Type: "aws_security_group", Action: "create",
			Properties: map[string]any{"ingress": []any{map[string]any{"cidr_blocks": []any{"10.0.0.0/16"}}}}}},
		{"azure deny from internet", ResourceChange{Address: "azurerm_network_security_rule.block", Type: "azurerm_network_security_rule", Action: "create",
			Properties: map[string]any{"direction": "Inbound", "access": "Deny", "source_address_prefix": "*"}}},
		{"database create", ResourceChange{Address: "aws_db_instance.main", Type: "aws_db_instance", Action: "create"}},
		{"no-op IAM", ResourceChange{Address: "aws_iam_role.app", Type: "aws_iam_role", Action: "no-op"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := baseline()
			in.ResourceChanges = []ResourceChange{tt.change}
			if got := mustEvaluate(t, in, DefaultConfig()); got.RequiresApproval {
				t.Fatalf("expected no approval, got %+v", got.TriggeredRules)
			}
		})
	}
}

func TestEvaluateAggregationPrecedence(t *testing.T) {
	in := baseline()
	in.Environment = "prod"
	in.CostEstimate.EstimatedMonthlyUSD = cost(900)
	in.ResourceChanges = []ResourceChange{{Address: "aws_iam_policy.ci", Type: "aws_iam_policy", Action: "create"}}

	got := mustEvaluate(t, in, DefaultConfig())
	wantRules := []string{RuleEnvironment, RuleCost, RuleResourceType}
	var rules []string
	for _, r := range got.TriggeredRules {
		rules = append(rules, r.Rule)
	}
	if !reflect.DeepEqual(rules, wantRules) {
		t.Fatalf("rules in order: got %v want %v", rules, wantRules)
	}
	// prod (high) + IAM (high): escalated, admin wins the high tie over security.
	if got.RiskLevel != RiskCritical {
		t.Fatalf("expected critical escalation, got %s", got.RiskLevel)
	}
	if *got.RequiredApproverRole != ApproverAdmin {
		t.Fatalf("expected admin approver, got %s", *got.RequiredApproverRole)
	}
	want := "production environment requires admin approval; estimated cost $900.00/month exceeds $500.00 approval threshold; IAM changes require security approval: aws_iam_policy.ci"
	if got.Reason != want {
		t.Fatalf("reason:\n got %q\nwant %q", got.Reason, want)
	}
}

func TestEvaluateHighestRiskRuleChoosesApprover(t *testing.T) {
	in := baseline()
	in.CostEstimate.EstimatedMonthlyUSD = cost(600) // finance, medium
	in.PublicExposure = true                        // security, high
	got := mustEvaluate(t, in, DefaultConfig())
	if *got.RequiredApproverRole != ApproverSecurity || got.RiskLevel != RiskHigh {
		t.Fatalf("got approver %s risk %s", *got.RequiredApproverRole, got.RiskLevel)
	}
}

func TestEvaluateProductionAloneIsNotEscalated(t *testing.T) {
	in := baseline()
	in.Environment = "prod"
	in.CostEstimate.EstimatedMonthlyUSD = cost(600)
	if got := mustEvaluate(t, in, DefaultConfig()); got.RiskLevel != RiskHigh {
		t.Fatalf("expected high, got %s", got.RiskLevel)
	}
}

func TestEvaluateIsDeterministicAcrossInputOrder(t *testing.T) {
	a := baseline()
	a.Environment = "PROD"
	a.ResourceChanges = []ResourceChange{
		{Address: "aws_iam_role.b", Type: "aws_iam_role", Action: "create"},
		{Address: "aws_iam_role.a", Type: "AWS_IAM_ROLE", Action: "Create"},
		{Address: "aws_lb.x", Type: "aws_lb", Public: true, Properties: map[string]any{"z": 1.0, "a": []any{"x"}}},
	}
	a.Policy = PolicyResult{Decision: policy.DecisionRequiresApproval, Violations: []policy.Violation{
		{RuleKey: "z.rule", Severity: policy.SeverityApproval},
		{RuleKey: "a.rule", Severity: policy.SeverityApproval},
	}}

	b := a
	b.Environment = "production"
	b.ResourceChanges = []ResourceChange{a.ResourceChanges[2], a.ResourceChanges[0], a.ResourceChanges[1]}
	b.Policy.Violations = []policy.Violation{a.Policy.Violations[1], a.Policy.Violations[0]}

	ga := mustEvaluate(t, a, DefaultConfig())
	gb := mustEvaluate(t, b, DefaultConfig())
	if !reflect.DeepEqual(ga, gb) {
		t.Fatalf("permuted input changed result:\n%+v\n%+v", ga, gb)
	}
	if !strings.Contains(ga.Reason, "aws_iam_role.a, aws_iam_role.b") || !strings.Contains(ga.Reason, "a.rule, z.rule") {
		t.Fatalf("reason not sorted: %q", ga.Reason)
	}
	for range 20 {
		if again := mustEvaluate(t, a, DefaultConfig()); again.InputDigest != ga.InputDigest {
			t.Fatal("digest not stable across runs")
		}
	}
}

func TestInputDigestCoversServerResolvedState(t *testing.T) {
	base := mustEvaluate(t, baseline(), DefaultConfig())

	role := baseline()
	role.UserRole = "admin"
	if mustEvaluate(t, role, DefaultConfig()).InputDigest == base.InputDigest {
		t.Fatal("digest ignores user role")
	}
	ws := baseline()
	ws.WorkspaceEnvironment = "staging"
	if mustEvaluate(t, ws, DefaultConfig()).InputDigest == base.InputDigest {
		t.Fatal("digest ignores workspace environment")
	}
	if mustEvaluate(t, baseline(), Config{CostThresholdUSD: 501}).InputDigest == base.InputDigest {
		t.Fatal("digest ignores config")
	}
}

func TestEvaluateRejectsDeniedPolicy(t *testing.T) {
	in := baseline()
	in.Policy.Decision = policy.DecisionDeny
	if _, err := Evaluate(in, DefaultConfig()); !errors.Is(err, ErrPolicyDenied) {
		t.Fatalf("expected ErrPolicyDenied, got %v", err)
	}
}

func TestEvaluateValidation(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*RunContext)
		field  string
	}{
		{"unknown environment", func(in *RunContext) { in.Environment = "qa-ish" }, "environment"},
		{"missing environment", func(in *RunContext) { in.Environment = "" }, "environment"},
		{"missing cost", func(in *RunContext) { in.CostEstimate.EstimatedMonthlyUSD = nil }, "cost_estimate.estimated_monthly_usd"},
		{"negative cost", func(in *RunContext) { in.CostEstimate.EstimatedMonthlyUSD = cost(-1) }, "cost_estimate.estimated_monthly_usd"},
		{"NaN cost", func(in *RunContext) { in.CostEstimate.EstimatedMonthlyUSD = cost(math.NaN()) }, "cost_estimate.estimated_monthly_usd"},
		{"missing policy decision", func(in *RunContext) { in.Policy.Decision = "" }, "policy.decision"},
		{"unknown action", func(in *RunContext) { in.ResourceChanges[0].Action = "destroy-all" }, "resource_changes[0].action"},
		{"missing type", func(in *RunContext) { in.ResourceChanges[0].Type = " " }, "resource_changes[0].type"},
		{"too many changes", func(in *RunContext) {
			in.ResourceChanges = make([]ResourceChange, maxResourceChanges+1)
		}, "resource_changes"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := baseline()
			tt.mutate(&in)
			_, err := Evaluate(in, DefaultConfig())
			var verr *ValidationError
			if !errors.As(err, &verr) || verr.Field != tt.field {
				t.Fatalf("expected validation error on %s, got %v", tt.field, err)
			}
		})
	}

	if _, err := Evaluate(baseline(), Config{CostThresholdUSD: -5}); err == nil {
		t.Fatal("expected negative threshold to fail")
	}
}

func TestEvaluateDefaultsMissingActionToCreate(t *testing.T) {
	in := baseline()
	in.ResourceChanges = []ResourceChange{{Address: "role", Type: "security.aws.iam_role"}}
	got := mustEvaluate(t, in, DefaultConfig())
	if !got.RequiresApproval || got.TriggeredRules[0].Rule != RuleResourceType {
		t.Fatalf("manifest IAM resource should require approval: %+v", got)
	}
}
