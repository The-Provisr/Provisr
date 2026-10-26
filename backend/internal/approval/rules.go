// Package approval implements the BE-E01 approval rule engine (PRD §16): a
// deterministic decision on whether a provisioning run requires approval, who
// must approve it and how risky it is. Evaluate is pure; the HTTP service in
// service.go resolves workspace configuration and requester role from the
// database and records every evaluation in the audit chain.
package approval

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/provisr/backend/internal/policy"
)

// RuleSetVersion identifies the rule semantics below. Bump it whenever a rule,
// threshold default or aggregation step changes so audit records stay
// interpretable.
const RuleSetVersion = "be-e01.v1"

// DefaultCostThresholdUSD applies when a workspace has no approval_rules
// cost_threshold_usd setting.
const DefaultCostThresholdUSD = 500.0

// highCostMultiplier escalates cost risk from medium to high.
const highCostMultiplier = 5.0

const maxResourceChanges = 1000

// CostSourceManifestEstimate is the only cost source until OR-M05 provides
// plan-based estimates.
const CostSourceManifestEstimate = "manifest_estimate"

type RiskLevel string

const (
	RiskLow      RiskLevel = "low"
	RiskMedium   RiskLevel = "medium"
	RiskHigh     RiskLevel = "high"
	RiskCritical RiskLevel = "critical"
)

var riskRank = map[RiskLevel]int{RiskLow: 0, RiskMedium: 1, RiskHigh: 2, RiskCritical: 3}

type ApproverRole string

const (
	ApproverAdmin    ApproverRole = "admin"
	ApproverSecurity ApproverRole = "security"
	ApproverFinance  ApproverRole = "finance"
)

// approverRank breaks ties between rules of equal risk.
var approverRank = map[ApproverRole]int{ApproverAdmin: 0, ApproverSecurity: 1, ApproverFinance: 2}

// Rule identifiers, in evaluation order.
const (
	RuleEnvironment     = "environment"
	RuleCost            = "cost"
	RuleResourceType    = "resource_type"
	RulePublicExposure  = "public_exposure"
	RulePolicyViolation = "policy_violation"
	RuleRole            = "role"
)

var (
	// ErrPolicyDenied is returned for DENY policy decisions: approval can never
	// override a deny, so the run must not reach the approval flow.
	ErrPolicyDenied = errors.New("policy decision is DENY; approval cannot override a denied run")
)

// ValidationError reports a malformed run context.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

// ResourceChange is one planned change. Type accepts Terraform resource types
// (aws_db_instance) and manifest types ({domain}.{provider}.{kind}). An empty
// action means create, matching manifest-only input.
type ResourceChange struct {
	Address    string         `json:"address"`
	Type       string         `json:"type"`
	Action     string         `json:"action"`
	Public     bool           `json:"public"`
	Properties map[string]any `json:"properties,omitempty"`
}

// CostEstimate mirrors manifest.CostEstimate's field name.
type CostEstimate struct {
	EstimatedMonthlyUSD *float64 `json:"estimated_monthly_usd"`
	Source              string   `json:"source"`
}

// PolicyResult is the outcome of the preceding check_policy call.
type PolicyResult struct {
	Decision   policy.Decision    `json:"decision"`
	Violations []policy.Violation `json:"violations"`
}

// RunContext is the rule input. UserRole and WorkspaceEnvironment are
// resolved server-side and never read from the request body.
type RunContext struct {
	WorkspaceID          string           `json:"workspace_id"`
	RunID                string           `json:"run_id,omitempty"`
	UserID               string           `json:"user_id"`
	Environment          string           `json:"environment"`
	Provider             string           `json:"provider"`
	Region               string           `json:"region"`
	PublicExposure       bool             `json:"public_exposure"`
	ResourceChanges      []ResourceChange `json:"resource_changes"`
	CostEstimate         CostEstimate     `json:"cost_estimate"`
	Policy               PolicyResult     `json:"policy"`
	UserRole             string           `json:"-"`
	WorkspaceEnvironment string           `json:"-"`
}

// Config is the per-workspace rule configuration.
type Config struct {
	CostThresholdUSD float64 `json:"cost_threshold_usd"`
}

func DefaultConfig() Config { return Config{CostThresholdUSD: DefaultCostThresholdUSD} }

type TriggeredRule struct {
	Rule         string       `json:"rule"`
	Reason       string       `json:"reason"`
	ApproverRole ApproverRole `json:"approver_role"`
	RiskLevel    RiskLevel    `json:"risk_level"`
}

// Requirement is the engine output. RequiredApproverRole is nil when no
// approval is required.
type Requirement struct {
	RequiresApproval     bool            `json:"requires_approval"`
	Reason               string          `json:"reason"`
	RequiredApproverRole *ApproverRole   `json:"required_approver_role"`
	RiskLevel            RiskLevel       `json:"risk_level"`
	TriggeredRules       []TriggeredRule `json:"triggered_rules"`
	RuleSetVersion       string          `json:"rule_set_version"`
	InputDigest          string          `json:"input_digest"`
	Config               Config          `json:"config"`
	CostSource           string          `json:"cost_source"`
}

// Evaluate applies the approval rules in fixed order. The same normalized
// input and config always produce the same Requirement and InputDigest.
func Evaluate(in RunContext, cfg Config) (Requirement, error) {
	norm, err := normalize(in)
	if err != nil {
		return Requirement{}, err
	}
	if math.IsNaN(cfg.CostThresholdUSD) || math.IsInf(cfg.CostThresholdUSD, 0) || cfg.CostThresholdUSD < 0 {
		return Requirement{}, &ValidationError{Field: "config.cost_threshold_usd", Message: "must be a non-negative number"}
	}

	digest, err := inputDigest(norm, cfg)
	if err != nil {
		return Requirement{}, err
	}

	var triggered []TriggeredRule
	triggered = append(triggered, checkEnvironment(norm)...)
	triggered = append(triggered, checkCost(norm, cfg)...)
	triggered = append(triggered, checkResourceTypes(norm)...)
	triggered = append(triggered, checkPublicExposure(norm)...)
	triggered = append(triggered, checkPolicy(norm)...)
	triggered = append(triggered, checkRole(norm)...)

	req := Requirement{
		RiskLevel:      RiskLow,
		TriggeredRules: []TriggeredRule{},
		RuleSetVersion: RuleSetVersion,
		InputDigest:    digest,
		Config:         cfg,
		CostSource:     norm.CostEstimate.Source,
		Reason:         "no approval rules matched",
	}
	if len(triggered) == 0 {
		return req, nil
	}

	req.RequiresApproval = true
	req.TriggeredRules = triggered

	reasons := make([]string, 0, len(triggered))
	top := triggered[0]
	production := false
	highCount := 0
	for _, t := range triggered {
		reasons = append(reasons, t.Reason)
		if riskRank[t.RiskLevel] > riskRank[req.RiskLevel] {
			req.RiskLevel = t.RiskLevel
		}
		if riskRank[t.RiskLevel] > riskRank[top.RiskLevel] ||
			(t.RiskLevel == top.RiskLevel && approverRank[t.ApproverRole] < approverRank[top.ApproverRole]) {
			top = t
		}
		if t.Rule == RuleEnvironment {
			production = true
		}
		if t.RiskLevel == RiskHigh {
			highCount++
		}
	}
	// A high-risk change landing in production is critical.
	if production && req.RiskLevel == RiskHigh && highCount > 1 {
		req.RiskLevel = RiskCritical
	}
	role := top.ApproverRole
	req.RequiredApproverRole = &role
	req.Reason = strings.Join(reasons, "; ")
	return req, nil
}

var environmentAliases = map[string]string{
	"dev": "dev", "development": "dev", "test": "dev",
	"staging": "staging", "stage": "staging",
	"prod": "prod", "production": "prod",
}

var validActions = map[string]bool{
	"create": true, "update": true, "delete": true, "replace": true, "no-op": true, "read": true,
}

var validDecisions = map[policy.Decision]bool{
	policy.DecisionAllow: true, policy.DecisionWarn: true, policy.DecisionRequiresApproval: true,
	policy.DecisionWaived: true, policy.DecisionDeny: true,
}

func normalize(in RunContext) (RunContext, error) {
	out := in
	out.Environment = strings.ToLower(strings.TrimSpace(in.Environment))
	env, ok := environmentAliases[out.Environment]
	if !ok {
		return RunContext{}, &ValidationError{Field: "environment", Message: "must be one of dev, staging, prod"}
	}
	out.Environment = env
	if ws := strings.ToLower(strings.TrimSpace(in.WorkspaceEnvironment)); ws != "" {
		out.WorkspaceEnvironment = environmentAliases[ws]
	}
	out.Provider = strings.ToLower(strings.TrimSpace(in.Provider))
	out.Region = strings.ToLower(strings.TrimSpace(in.Region))
	out.UserRole = strings.ToLower(strings.TrimSpace(in.UserRole))

	if len(in.ResourceChanges) > maxResourceChanges {
		return RunContext{}, &ValidationError{Field: "resource_changes", Message: fmt.Sprintf("must not exceed %d entries", maxResourceChanges)}
	}
	out.ResourceChanges = make([]ResourceChange, len(in.ResourceChanges))
	for i, c := range in.ResourceChanges {
		c.Type = strings.ToLower(strings.TrimSpace(c.Type))
		c.Address = strings.TrimSpace(c.Address)
		c.Action = strings.ToLower(strings.TrimSpace(c.Action))
		if c.Action == "" {
			c.Action = "create"
		}
		if c.Type == "" {
			return RunContext{}, &ValidationError{Field: fmt.Sprintf("resource_changes[%d].type", i), Message: "is required"}
		}
		if !validActions[c.Action] {
			return RunContext{}, &ValidationError{Field: fmt.Sprintf("resource_changes[%d].action", i), Message: "must be one of create, update, delete, replace, no-op, read"}
		}
		if c.Address == "" {
			c.Address = c.Type
		}
		out.ResourceChanges[i] = c
	}
	sort.SliceStable(out.ResourceChanges, func(i, j int) bool {
		a, b := out.ResourceChanges[i], out.ResourceChanges[j]
		if a.Address != b.Address {
			return a.Address < b.Address
		}
		if a.Type != b.Type {
			return a.Type < b.Type
		}
		return a.Action < b.Action
	})

	cost := in.CostEstimate.EstimatedMonthlyUSD
	if cost == nil {
		return RunContext{}, &ValidationError{Field: "cost_estimate.estimated_monthly_usd", Message: "is required"}
	}
	if math.IsNaN(*cost) || math.IsInf(*cost, 0) || *cost < 0 {
		return RunContext{}, &ValidationError{Field: "cost_estimate.estimated_monthly_usd", Message: "must be a non-negative number"}
	}
	v := *cost
	out.CostEstimate.EstimatedMonthlyUSD = &v
	out.CostEstimate.Source = strings.ToLower(strings.TrimSpace(in.CostEstimate.Source))
	if out.CostEstimate.Source == "" {
		out.CostEstimate.Source = CostSourceManifestEstimate
	}

	out.Policy.Decision = policy.Decision(strings.ToUpper(strings.TrimSpace(string(in.Policy.Decision))))
	if !validDecisions[out.Policy.Decision] {
		return RunContext{}, &ValidationError{Field: "policy.decision", Message: "must be one of ALLOW, WARN, REQUIRES_APPROVAL, WAIVED, DENY"}
	}
	if out.Policy.Decision == policy.DecisionDeny {
		return RunContext{}, ErrPolicyDenied
	}
	out.Policy.Violations = append([]policy.Violation{}, in.Policy.Violations...)
	sort.SliceStable(out.Policy.Violations, func(i, j int) bool {
		a, b := out.Policy.Violations[i], out.Policy.Violations[j]
		if a.RuleKey != b.RuleKey {
			return a.RuleKey < b.RuleKey
		}
		if a.Severity != b.Severity {
			return a.Severity < b.Severity
		}
		return a.Evidence < b.Evidence
	})
	return out, nil
}

// inputDigest hashes the normalized input, including server-resolved fields,
// together with the effective config. encoding/json sorts map keys, so the
// encoding is canonical for a given normalized input.
func inputDigest(in RunContext, cfg Config) (string, error) {
	payload, err := json.Marshal(struct {
		RuleSetVersion       string     `json:"rule_set_version"`
		Input                RunContext `json:"input"`
		UserRole             string     `json:"user_role"`
		WorkspaceEnvironment string     `json:"workspace_environment"`
		Config               Config     `json:"config"`
	}{RuleSetVersion, in, in.UserRole, in.WorkspaceEnvironment, cfg})
	if err != nil {
		return "", fmt.Errorf("encode approval input: %w", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

// Rule 1: production runs require admin approval. Either the run or the
// workspace being production is enough: the more restrictive source wins.
func checkEnvironment(in RunContext) []TriggeredRule {
	if in.Environment != "prod" && in.WorkspaceEnvironment != "prod" {
		return nil
	}
	return []TriggeredRule{{
		Rule:         RuleEnvironment,
		Reason:       "production environment requires admin approval",
		ApproverRole: ApproverAdmin,
		RiskLevel:    RiskHigh,
	}}
}

// Rule 2: runs above the configured monthly threshold require finance approval.
func checkCost(in RunContext, cfg Config) []TriggeredRule {
	cost := *in.CostEstimate.EstimatedMonthlyUSD
	if cost <= cfg.CostThresholdUSD {
		return nil
	}
	risk := RiskMedium
	if cost >= cfg.CostThresholdUSD*highCostMultiplier {
		risk = RiskHigh
	}
	return []TriggeredRule{{
		Rule:         RuleCost,
		Reason:       fmt.Sprintf("estimated cost $%.2f/month exceeds $%.2f approval threshold", cost, cfg.CostThresholdUSD),
		ApproverRole: ApproverFinance,
		RiskLevel:    risk,
	}}
}

// Rule 3: database deletion, IAM changes and wide-open security groups.
// Each category reports once with the affected addresses.
func checkResourceTypes(in RunContext) []TriggeredRule {
	var dbDeletes, iamChanges, openGroups []string
	for _, c := range in.ResourceChanges {
		if !mutating(c.Action) {
			continue
		}
		if destructive(c.Action) && isDatabase(c.Type) {
			dbDeletes = append(dbDeletes, c.Address)
		}
		if isIAM(c.Type) {
			iamChanges = append(iamChanges, c.Address)
		}
		if c.Action != "delete" && isFirewall(c.Type) && wideOpenIngress(c.Properties, "") {
			openGroups = append(openGroups, c.Address)
		}
	}
	var out []TriggeredRule
	if len(dbDeletes) > 0 {
		out = append(out, TriggeredRule{
			Rule:         RuleResourceType,
			Reason:       "database deletion requires admin approval: " + strings.Join(dbDeletes, ", "),
			ApproverRole: ApproverAdmin,
			RiskLevel:    RiskCritical,
		})
	}
	if len(iamChanges) > 0 {
		out = append(out, TriggeredRule{
			Rule:         RuleResourceType,
			Reason:       "IAM changes require security approval: " + strings.Join(iamChanges, ", "),
			ApproverRole: ApproverSecurity,
			RiskLevel:    RiskHigh,
		})
	}
	if len(openGroups) > 0 {
		out = append(out, TriggeredRule{
			Rule:         RuleResourceType,
			Reason:       "security group open to the internet requires security approval: " + strings.Join(openGroups, ", "),
			ApproverRole: ApproverSecurity,
			RiskLevel:    RiskHigh,
		})
	}
	return out
}

// Rule 4: any resource with public internet access.
func checkPublicExposure(in RunContext) []TriggeredRule {
	var public []string
	for _, c := range in.ResourceChanges {
		if c.Public && mutating(c.Action) && c.Action != "delete" {
			public = append(public, c.Address)
		}
	}
	if !in.PublicExposure && len(public) == 0 {
		return nil
	}
	reason := "public internet exposure requires security approval"
	if len(public) > 0 {
		reason += ": " + strings.Join(public, ", ")
	}
	return []TriggeredRule{{
		Rule:         RulePublicExposure,
		Reason:       reason,
		ApproverRole: ApproverSecurity,
		RiskLevel:    RiskHigh,
	}}
}

// Rule 5: REQUIRES_APPROVAL policy decisions and approval-class violations.
func checkPolicy(in RunContext) []TriggeredRule {
	var keys []string
	seen := map[string]bool{}
	for _, v := range in.Policy.Violations {
		if v.Severity == policy.SeverityApproval && !seen[v.RuleKey] {
			seen[v.RuleKey] = true
			keys = append(keys, v.RuleKey)
		}
	}
	if in.Policy.Decision != policy.DecisionRequiresApproval && len(keys) == 0 {
		return nil
	}
	reason := "policy decision requires approval"
	if len(keys) > 0 {
		reason += ": " + strings.Join(keys, ", ")
	}
	return []TriggeredRule{{
		Rule:         RulePolicyViolation,
		Reason:       reason,
		ApproverRole: ApproverSecurity,
		RiskLevel:    RiskMedium,
	}}
}

// Rule 6: non-admins need admin approval for destructive changes; roles
// without provisioning rights (approver, auditor, viewer, unknown) need it for
// any change.
func checkRole(in RunContext) []TriggeredRule {
	if in.UserRole == "admin" {
		return nil
	}
	anyChange, anyDestructive := false, false
	for _, c := range in.ResourceChanges {
		if mutating(c.Action) {
			anyChange = true
		}
		if destructive(c.Action) {
			anyDestructive = true
		}
	}
	role := in.UserRole
	if role == "" {
		role = "unknown"
	}
	switch {
	case in.UserRole != "engineer" && anyChange:
		return []TriggeredRule{{
			Rule:         RuleRole,
			Reason:       fmt.Sprintf("role %q cannot provision without admin approval", role),
			ApproverRole: ApproverAdmin,
			RiskLevel:    RiskMedium,
		}}
	case anyDestructive:
		return []TriggeredRule{{
			Rule:         RuleRole,
			Reason:       fmt.Sprintf("destructive changes by role %q require admin approval", role),
			ApproverRole: ApproverAdmin,
			RiskLevel:    RiskMedium,
		}}
	}
	return nil
}

func mutating(action string) bool {
	return action == "create" || action == "update" || action == "delete" || action == "replace"
}

func destructive(action string) bool { return action == "delete" || action == "replace" }

var databaseTypePrefixes = []string{
	"database.",
	"aws_db_instance", "aws_db_cluster", "aws_rds_cluster", "aws_dynamodb_table", "aws_docdb_cluster",
	"aws_neptune_cluster", "aws_redshift_cluster", "aws_elasticache_cluster", "aws_elasticache_replication_group",
	"aws_memorydb_cluster", "aws_opensearch_domain", "aws_elasticsearch_domain", "aws_timestreamwrite_database",
	"google_sql_", "google_spanner_", "google_bigtable_", "google_firestore_database", "google_alloydb_",
	"google_redis_instance", "google_bigquery_dataset", "google_bigquery_table",
	"azurerm_mssql_", "azurerm_sql_", "azurerm_postgresql_", "azurerm_mysql_", "azurerm_mariadb_",
	"azurerm_cosmosdb_", "azurerm_redis_cache",
}

func isDatabase(t string) bool {
	for _, p := range databaseTypePrefixes {
		if strings.HasPrefix(t, p) {
			return true
		}
	}
	return false
}

func isIAM(t string) bool {
	return strings.Contains(t, "iam") ||
		strings.HasPrefix(t, "azurerm_role_") ||
		strings.HasPrefix(t, "azuread_")
}

func isFirewall(t string) bool {
	return strings.Contains(t, "security_group") ||
		strings.Contains(t, "firewall") ||
		strings.Contains(t, "network_security_rule") ||
		strings.HasSuffix(t, ".nsg")
}

// wideOpenIngress reports whether properties contain an inbound allow rule
// from anywhere (0.0.0.0/0, ::/0, or Azure "*"/"Internet" source prefixes).
// Egress/outbound and deny rules are ignored. The walk is provider-agnostic so
// it covers aws_security_group ingress blocks, standalone rule resources,
// google_compute_firewall source_ranges and Azure NSG rules.
func wideOpenIngress(v any, key string) bool {
	switch val := v.(type) {
	case map[string]any:
		for _, field := range []string{"direction", "type"} {
			if s, ok := val[field].(string); ok {
				switch strings.ToLower(s) {
				case "egress", "outbound":
					return false
				}
			}
		}
		if s, ok := val["access"].(string); ok && strings.EqualFold(s, "deny") {
			return false
		}
		for k, child := range val {
			lk := strings.ToLower(k)
			if strings.Contains(lk, "egress") || strings.Contains(lk, "outbound") || strings.Contains(lk, "destination") {
				continue
			}
			if wideOpenIngress(child, lk) {
				return true
			}
		}
	case []any:
		for _, child := range val {
			if wideOpenIngress(child, key) {
				return true
			}
		}
	case []string:
		for _, child := range val {
			if wideOpenIngress(child, key) {
				return true
			}
		}
	case string:
		s := strings.ToLower(strings.TrimSpace(val))
		if s == "0.0.0.0/0" || s == "::/0" {
			return true
		}
		if strings.Contains(key, "source_address_prefix") && (s == "*" || s == "internet" || s == "any") {
			return true
		}
	}
	return false
}
