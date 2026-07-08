package handler

import (
	"encoding/json"
	"net/http"

	"github.com/provisr/platform/services/policy/internal/evaluator"
)

type EvaluateRequest struct {
	OrgID            string   `json:"org_id"`
	MonthlyBudgetUSD float64  `json:"monthly_budget_usd"`
	AllowedRegions   []string `json:"allowed_regions"`
	RequiredTags     []string `json:"required_tags"`
	Manifest         Manifest `json:"manifest"`
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

type PolicyHandler struct {
	evaluator *evaluator.Evaluator
}

func NewPolicyHandler(e *evaluator.Evaluator) *PolicyHandler {
	return &PolicyHandler{
		evaluator: e,
	}
}

func (h *PolicyHandler) EvaluatePolicy(w http.ResponseWriter, r *http.Request) {
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

	result, err := h.evaluator.Evaluate(r.Context(), req)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)

		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Allowed:  false,
			Decision: "deny",
			Violations: []Violation{
				{
					Code:    "POLICY_EVALUATION_FAILED",
					Message: "Policy evaluation failed.",
				},
			},
		})
		return
	}

	response := EvaluateResponse{
		Allowed:    result.Allowed,
		Decision:   result.Decision,
		Violations: []Violation{},
	}

	for _, violation := range result.Violations {
		response.Violations = append(response.Violations, Violation{
			Code:    "POLICY_VIOLATION",
			Message: violation,
		})
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}
