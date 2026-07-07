package handler

import (
	"encoding/json"
	"net/http"
)

type EvaluateRequest struct {
	OrgID            string   `json:"org_id"`
	MonthlyBudgetUSD float64 `json:"monthly_budget_usd"`
	AllowedRegions  []string `json:"allowed_regions"`
	RequiredTags    []string `json:"required_tags"`
	Manifest        Manifest `json:"manifest"`
}

type Manifest struct {
	Provider                string            `json:"provider"`
	Region                  string            `json:"region"`
	EstimatedMonthlyCostUSD float64           `json:"estimated_monthly_cost_usd"`
	Tags                    map[string]string `json:"tags"`
}

type Violation struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type EvaluateResponse struct {
	Allowed    bool        `json:"allowed"`
	Decision   string      `json:"decision"`
	Violations []Violation `json:"violations"`
}

func EvaluatePolicy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req EvaluateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)

		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Allowed:  false,
			Decision: "deny",
			Violations: []Violation{
				{
					Code:    "INVALID_JSON",
					Message: "Request body must be valid JSON.",
				},
			},
		})
		return
	}

	// Mock response for Task 01.
	// Later, this will call the OPA/Rego evaluator.
	response := EvaluateResponse{
		Allowed:    true,
		Decision:   "allow",
		Violations: []Violation{},
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}