package policy

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type PolicyRequirements struct {
	AllowedRegions          []string `json:"allowed_regions,omitempty"`
	MaxMonthlyBudgetUSD     float64  `json:"max_monthly_budget_usd,omitempty"`
	RequiredTags            []string `json:"required_tags,omitempty"`
	ProhibitedResourceTypes []string `json:"prohibited_resource_types,omitempty"`
	RequiredEncryption      bool     `json:"required_encryption,omitempty"`
	Warnings                []string `json:"warnings,omitempty"`
}

func ProjectPolicyRequirements(ctx context.Context, db *sql.DB, workspaceID string) (PolicyRequirements, error) {
	reqs := PolicyRequirements{
		AllowedRegions:          []string{},
		RequiredTags:            []string{},
		ProhibitedResourceTypes: []string{},
		Warnings:                []string{},
	}

	// 1. Get enabled pack IDs for the workspace
	var packIDsArray []byte
	err := db.QueryRowContext(ctx,
		`SELECT enabled_pack_ids
		 FROM provisr_policy.workspace_policy_settings
		 WHERE workspace_id = $1`,
		workspaceID,
	).Scan(&packIDsArray)
	
	if err == sql.ErrNoRows {
		// No settings = no packs enabled
		return reqs, nil
	}
	if err != nil {
		return reqs, fmt.Errorf("failed to query workspace policy settings: %w", err)
	}

	var packIDs []string
	if err := json.Unmarshal(packIDsArray, &packIDs); err != nil && string(packIDsArray) != "{}" {
		// Postgres UUID[] driver encoding depends on the scanner. 
		// If it's a native array, we need a pq.StringArray. Let's use string manipulation if it's `{...}` format.
		s := string(packIDsArray)
		s = strings.TrimPrefix(s, "{")
		s = strings.TrimSuffix(s, "}")
		if s != "" {
			packIDs = strings.Split(s, ",")
		}
	}

	if len(packIDs) == 0 {
		return reqs, nil
	}

	// 2. Query enabled rules for those packs
	args := make([]any, len(packIDs))
	placeholders := make([]string, len(packIDs))
	for i, id := range packIDs {
		args[i] = id
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}

	query := fmt.Sprintf(`
		SELECT rule_key, parameters_schema
		FROM provisr_policy.policy_rules
		WHERE is_enabled = true AND pack_id IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return reqs, fmt.Errorf("failed to query enabled policy rules: %w", err)
	}
	defer rows.Close()

	hasComplexRules := false

	// 3. Project rules into constraints
	for rows.Next() {
		var ruleKey string
		var paramsSchema []byte
		if err := rows.Scan(&ruleKey, &paramsSchema); err != nil {
			return reqs, fmt.Errorf("failed to scan policy rule: %w", err)
		}

		var params map[string]any
		if err := json.Unmarshal(paramsSchema, &params); err != nil {
			continue // Skip malformed params
		}

		switch ruleKey {
		case "allowed_regions":
			if regions, ok := params["regions"].([]any); ok {
				for _, r := range regions {
					if str, ok := r.(string); ok {
						reqs.AllowedRegions = append(reqs.AllowedRegions, str)
					}
				}
			}
		case "budget_max":
			if maxUSD, ok := params["max_usd"].(float64); ok {
				reqs.MaxMonthlyBudgetUSD = maxUSD
			}
		case "required_tags":
			if tags, ok := params["tags"].([]any); ok {
				for _, t := range tags {
					if str, ok := t.(string); ok {
						reqs.RequiredTags = append(reqs.RequiredTags, str)
					}
				}
			}
		case "require_encryption":
			reqs.RequiredEncryption = true
		case "no_public_s3":
			reqs.ProhibitedResourceTypes = append(reqs.ProhibitedResourceTypes, "aws_s3_bucket_public_access_block:public")
		case "iam_no_wildcard":
			hasComplexRules = true
		default:
			// Unknown or complex rule
			hasComplexRules = true
		}
	}

	if hasComplexRules {
		reqs.Warnings = append(reqs.Warnings, "Additional complex policies will be evaluated during the formal policy check phase. Proceed with caution for IAM and custom configurations.")
	}

	return reqs, nil
}
