package policy

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// EvaluationRequest represents a policy check request payload.
type EvaluationRequest struct {
	WorkspaceID string         `json:"workspace_id"`
	CheckType   string         `json:"check_type"` // "manifest" or "plan"
	Input       map[string]any `json:"input"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

// EvaluationResponse is the structured policy evaluation decision.
type EvaluationResponse struct {
	Decision          Decision    `json:"decision"`
	Violations        []Violation `json:"violations"`
	PoliciesEvaluated int         `json:"policies_evaluated"`
	EvaluatedAt       string      `json:"evaluated_at"`
}

// Engine implements in-memory OPA/Rego-compatible policy evaluations.
type Engine struct {
	defaultAllowedRegions []string
	defaultRequiredTags   []string
	defaultMaxBudgetUSD   float64
}

// NewEngine creates a new in-memory policy evaluation engine.
func NewEngine() *Engine {
	return &Engine{
		defaultAllowedRegions: []string{"us-east-1", "us-east-2", "us-west-2", "eu-west-1"},
		defaultRequiredTags:   []string{"Environment", "Owner"},
		defaultMaxBudgetUSD:   1000.0,
	}
}

type normalizedResource struct {
	ID         string
	Type       string
	Region     string
	Properties map[string]any
	Tags       map[string]string
}

// Evaluate evaluates the input against all active policy rules.
func (e *Engine) Evaluate(ctx context.Context, req EvaluationRequest) (*EvaluationResponse, error) {
	if req.Input == nil {
		req.Input = map[string]any{}
	}

	resources := e.extractResources(req.Input)
	cost := e.extractCost(req.Input)
	topRegion := e.extractRegion(req.Input)

	var violations []Violation
	policiesCount := 6

	// Rule 1: security.no_public_s3
	violations = append(violations, e.checkNoPublicS3(resources)...)

	// Rule 2: security.require_encryption
	violations = append(violations, e.checkRequireEncryption(resources)...)

	// Rule 3: security.iam_no_wildcards
	violations = append(violations, e.checkIAMNoWildcards(resources)...)

	// Rule 4: cost.max_monthly_budget
	maxBudget := e.defaultMaxBudgetUSD
	if req.Parameters != nil {
		if mb, ok := req.Parameters["max_usd"].(float64); ok && mb > 0 {
			maxBudget = mb
		}
	}
	if v := e.checkBudget(cost, maxBudget); v != nil {
		violations = append(violations, *v)
	}

	// Rule 5: compliance.allowed_regions
	allowedRegions := e.defaultAllowedRegions
	if req.Parameters != nil {
		if rawRegions, ok := req.Parameters["regions"].([]any); ok && len(rawRegions) > 0 {
			var parsed []string
			for _, r := range rawRegions {
				if s, ok := r.(string); ok {
					parsed = append(parsed, s)
				}
			}
			if len(parsed) > 0 {
				allowedRegions = parsed
			}
		}
	}
	violations = append(violations, e.checkAllowedRegions(resources, topRegion, allowedRegions)...)

	// Rule 6: compliance.required_tags
	requiredTags := e.defaultRequiredTags
	if req.Parameters != nil {
		if rawTags, ok := req.Parameters["tags"].([]any); ok && len(rawTags) > 0 {
			var parsed []string
			for _, t := range rawTags {
				if s, ok := t.(string); ok {
					parsed = append(parsed, s)
				}
			}
			if len(parsed) > 0 {
				requiredTags = parsed
			}
		}
	}
	violations = append(violations, e.checkRequiredTags(resources, requiredTags)...)

	decision := AggregateDecision(violations, false)

	return &EvaluationResponse{
		Decision:          decision,
		Violations:        violations,
		PoliciesEvaluated: policiesCount,
		EvaluatedAt:       time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func (e *Engine) extractResources(input map[string]any) []normalizedResource {
	var resources []normalizedResource

	// 1. Check Terraform plan style: resource_changes
	if rc, ok := input["resource_changes"].([]any); ok {
		for i, raw := range rc {
			if rMap, ok := raw.(map[string]any); ok {
				rType, _ := rMap["type"].(string)
				rName, _ := rMap["name"].(string)
				if rName == "" {
					rName = fmt.Sprintf("res_%d", i)
				}
				props := map[string]any{}
				var tags map[string]string

				if change, ok := rMap["change"].(map[string]any); ok {
					if after, ok := change["after"].(map[string]any); ok {
						props = after
						tags = extractTagsMap(after["tags"])
					}
				}
				resources = append(resources, normalizedResource{
					ID:         rName,
					Type:       rType,
					Properties: props,
					Tags:       tags,
				})
			}
		}
	}

	// 2. Check manifest style: resources array
	if resList, ok := input["resources"].([]any); ok {
		for i, raw := range resList {
			if rMap, ok := raw.(map[string]any); ok {
				rID, _ := rMap["id"].(string)
				if rID == "" {
					rID, _ = rMap["name"].(string)
				}
				if rID == "" {
					rID = fmt.Sprintf("manifest_res_%d", i)
				}
				rType, _ := rMap["type"].(string)
				rRegion, _ := rMap["region"].(string)

				props := map[string]any{}
				if p, ok := rMap["properties"].(map[string]any); ok {
					props = p
				} else if c, ok := rMap["configuration"].(map[string]any); ok {
					props = c
				} else if pv, ok := rMap["planned_values"].(map[string]any); ok {
					props = pv
				}

				tags := extractTagsMap(rMap["tags"])
				if len(tags) == 0 && props != nil {
					tags = extractTagsMap(props["tags"])
				}

				resources = append(resources, normalizedResource{
					ID:         rID,
					Type:       rType,
					Region:     rRegion,
					Properties: props,
					Tags:       tags,
				})
			}
		}
	}

	// 3. Check single top-level resource
	if rType, ok := input["resource_type"].(string); ok && rType != "" {
		props := map[string]any{}
		if pv, ok := input["planned_values"].(map[string]any); ok {
			props = pv
		}
		tags := extractTagsMap(props["tags"])
		resources = append(resources, normalizedResource{
			ID:         "root_resource",
			Type:       rType,
			Properties: props,
			Tags:       tags,
		})
	}

	return resources
}

func (e *Engine) extractCost(input map[string]any) float64 {
	if cost, ok := input["estimated_monthly_cost_usd"].(float64); ok {
		return cost
	}
	if costMap, ok := input["cost"].(map[string]any); ok {
		if cost, ok := costMap["estimated_monthly_cost_usd"].(float64); ok {
			return cost
		}
	}
	return 0.0
}

func (e *Engine) extractRegion(input map[string]any) string {
	if r, ok := input["region"].(string); ok && r != "" {
		return r
	}
	if meta, ok := input["metadata"].(map[string]any); ok {
		if r, ok := meta["region"].(string); ok && r != "" {
			return r
		}
	}
	return ""
}

func extractTagsMap(raw any) map[string]string {
	tags := map[string]string{}
	if raw == nil {
		return tags
	}
	if m, ok := raw.(map[string]any); ok {
		for k, v := range m {
			if s, ok := v.(string); ok {
				tags[k] = s
			}
		}
	} else if m, ok := raw.(map[string]string); ok {
		return m
	}
	return tags
}

func (e *Engine) checkNoPublicS3(resources []normalizedResource) []Violation {
	var violations []Violation
	publicACLs := map[string]bool{
		"public-read":       true,
		"public-read-write": true,
		"public":            true,
	}

	for _, res := range resources {
		t := strings.ToLower(res.Type)
		if strings.Contains(t, "s3_bucket") || strings.Contains(t, "storage.bucket") || t == "s3" {
			acl, _ := res.Properties["acl"].(string)
			if publicACLs[strings.ToLower(acl)] {
				violations = append(violations, Violation{
					RuleKey:         "security.no_public_s3",
					Severity:        SeverityDeny,
					Description:     "Deny S3 buckets with public ACLs",
					Evidence:        fmt.Sprintf("S3 bucket %q has public ACL %q", res.ID, acl),
					RemediationHint: "Set the S3 bucket ACL to private or use bucket policies for controlled access.",
				})
			}

			if pab, ok := res.Properties["public_access_block_enabled"].(bool); ok && !pab {
				violations = append(violations, Violation{
					RuleKey:         "security.no_public_s3",
					Severity:        SeverityDeny,
					Description:     "Deny S3 buckets without public access block",
					Evidence:        fmt.Sprintf("S3 bucket %q has public_access_block_enabled set to false", res.ID),
					RemediationHint: "Enable Block Public Access on the S3 bucket.",
				})
			}
		}
	}
	return violations
}

func (e *Engine) checkRequireEncryption(resources []normalizedResource) []Violation {
	var violations []Violation
	for _, res := range resources {
		t := strings.ToLower(res.Type)
		isStorage := strings.Contains(t, "ebs_volume") ||
			strings.Contains(t, "s3_bucket") ||
			strings.Contains(t, "db_instance") ||
			strings.Contains(t, "rds") ||
			strings.Contains(t, "disk") ||
			strings.Contains(t, "database")

		if isStorage {
			if enc, exists := res.Properties["encrypted"]; exists {
				if isEnc, ok := enc.(bool); ok && !isEnc {
					violations = append(violations, Violation{
						RuleKey:         "security.require_encryption",
						Severity:        SeverityDeny,
						Description:     "Require encryption on storage resources",
						Evidence:        fmt.Sprintf("Resource %q (%s) has encryption disabled", res.ID, res.Type),
						RemediationHint: "Enable encryption at rest for all storage resources (EBS, S3, RDS).",
					})
				}
			} else if enc, exists := res.Properties["encryption"]; exists {
				if isEnc, ok := enc.(bool); ok && !isEnc {
					violations = append(violations, Violation{
						RuleKey:         "security.require_encryption",
						Severity:        SeverityDeny,
						Description:     "Require encryption on storage resources",
						Evidence:        fmt.Sprintf("Resource %q (%s) has encryption disabled", res.ID, res.Type),
						RemediationHint: "Enable encryption at rest for all storage resources (EBS, S3, RDS).",
					})
				}
			}
		}
	}
	return violations
}

func (e *Engine) checkIAMNoWildcards(resources []normalizedResource) []Violation {
	var violations []Violation
	for _, res := range resources {
		t := strings.ToLower(res.Type)
		if strings.Contains(t, "iam_policy") || strings.Contains(t, "iam_role") || strings.Contains(t, "policy") {
			hasWildcard := false

			// Check structured statement
			if statements, ok := res.Properties["statement"].([]any); ok {
				for _, stmtRaw := range statements {
					if stmt, ok := stmtRaw.(map[string]any); ok {
						if actions, ok := stmt["actions"].([]any); ok {
							for _, a := range actions {
								if s, ok := a.(string); ok && (s == "*" || s == "*:*") {
									hasWildcard = true
									break
								}
							}
						}
					}
				}
			}

			// Check raw policy string or JSON
			if policyStr, ok := res.Properties["policy"].(string); ok && !hasWildcard {
				if strings.Contains(policyStr, `Action": "*"`) ||
					strings.Contains(policyStr, `Action":"*"`) ||
					strings.Contains(policyStr, `Action": ["*"]`) ||
					strings.Contains(policyStr, `actions": ["*"]`) {
					hasWildcard = true
				}
			}

			if hasWildcard {
				violations = append(violations, Violation{
					RuleKey:         "security.iam_no_wildcards",
					Severity:        SeverityDeny,
					Description:     "Deny IAM policies with wildcard actions",
					Evidence:        fmt.Sprintf("IAM policy %q contains wildcard (*) action", res.ID),
					RemediationHint: "Replace wildcard (*) actions with specific, least-privilege permissions.",
				})
			}
		}
	}
	return violations
}

func (e *Engine) checkBudget(cost float64, maxBudget float64) *Violation {
	if cost > maxBudget {
		severity := SeverityWarn
		// If cost exceeds double the budget, force approval requirement
		if cost >= maxBudget*2.0 {
			severity = SeverityApproval
		}
		return &Violation{
			RuleKey:         "cost.max_monthly_budget",
			Severity:        severity,
			Description:     "Warn when estimated monthly cost exceeds budget",
			Evidence:        fmt.Sprintf("Estimated monthly cost $%.2f exceeds budget $%.2f", cost, maxBudget),
			RemediationHint: "Review resource sizing or request a budget increase.",
		}
	}
	return nil
}

func (e *Engine) checkAllowedRegions(resources []normalizedResource, topRegion string, allowedRegions []string) []Violation {
	var violations []Violation
	allowedSet := make(map[string]bool, len(allowedRegions))
	for _, r := range allowedRegions {
		allowedSet[strings.ToLower(r)] = true
	}

	if topRegion != "" && !allowedSet[strings.ToLower(topRegion)] {
		violations = append(violations, Violation{
			RuleKey:         "compliance.allowed_regions",
			Severity:        SeverityDeny,
			Description:     "Restrict resources to allowed regions",
			Evidence:        fmt.Sprintf("Global region %q is not in the allowed list: %s", topRegion, strings.Join(allowedRegions, ", ")),
			RemediationHint: "Deploy resources only in approved regions.",
		})
	}

	for _, res := range resources {
		if res.Region != "" && !allowedSet[strings.ToLower(res.Region)] {
			violations = append(violations, Violation{
				RuleKey:         "compliance.allowed_regions",
				Severity:        SeverityDeny,
				Description:     "Restrict resources to allowed regions",
				Evidence:        fmt.Sprintf("Resource %q region %q is not in the allowed list: %s", res.ID, res.Region, strings.Join(allowedRegions, ", ")),
				RemediationHint: "Deploy resources only in approved regions.",
			})
		}
	}

	return violations
}

func (e *Engine) checkRequiredTags(resources []normalizedResource, requiredTags []string) []Violation {
	var violations []Violation
	for _, res := range resources {
		// Ignore IAM policies or regional configs from tag requirements
		t := strings.ToLower(res.Type)
		if strings.Contains(t, "iam_policy") || t == "" {
			continue
		}

		for _, tag := range requiredTags {
			if _, found := res.Tags[tag]; !found {
				violations = append(violations, Violation{
					RuleKey:         "compliance.required_tags",
					Severity:        SeverityWarn,
					Description:     "Require specific tags on all resources",
					Evidence:        fmt.Sprintf("Resource %q is missing required tag %q", res.ID, tag),
					RemediationHint: "Add the required tags to the resource configuration.",
				})
			}
		}
	}
	return violations
}
