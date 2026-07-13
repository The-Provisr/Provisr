package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/provisr/platform/services/policy/internal/evaluator"
	"github.com/provisr/platform/services/policy/internal/repository"
)

type EvaluateRequest struct {
	OrgID    string   `json:"org_id"`
	Manifest Manifest `json:"manifest"`
}

type Manifest struct {
	Provider                string            `json:"provider"`
	Region                  string            `json:"region"`
	EstimatedMonthlyCostUSD float64           `json:"estimated_monthly_cost_usd"`
	Tags                    map[string]string `json:"tags"`
}

type EvaluateResponse struct {
	Passed     bool                  `json:"passed"`
	Violations []evaluator.Violation `json:"violations"`
}

type PolicyEvaluator interface {
	Evaluate(context.Context, any) (evaluator.EvaluationResult, error)
}

type OrganizationPolicyRepository interface {
	GetOrganizationPolicy(context.Context, string) (repository.OrganizationPolicy, error)
}

type PolicyHandler struct {
	evaluator  PolicyEvaluator
	repository OrganizationPolicyRepository
}

func NewPolicyHandler(e PolicyEvaluator, repo OrganizationPolicyRepository) *PolicyHandler {
	return &PolicyHandler{
		evaluator:  e,
		repository: repo,
	}
}

func (h *PolicyHandler) EvaluatePolicy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req EvaluateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)

		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Passed: false,
			Violations: []evaluator.Violation{
				{
					Rule:    "request",
					Code:    "INVALID_JSON",
					Message: "Request body must be valid JSON.",
				},
			},
		})
		return
	}

	if req.OrgID == "" || req.Manifest.Provider == "" || req.Manifest.Region == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Passed: false,
			Violations: []evaluator.Violation{{
				Rule:    "request",
				Code:    "VALIDATION_ERROR",
				Message: "org_id, manifest.provider, and manifest.region are required.",
			}},
		})
		return
	}
	if _, err := uuid.Parse(req.OrgID); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Passed: false,
			Violations: []evaluator.Violation{{
				Rule:    "request",
				Code:    "VALIDATION_ERROR",
				Message: "org_id must be a valid UUID.",
			}},
		})
		return
	}
	if req.Manifest.EstimatedMonthlyCostUSD < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Passed: false,
			Violations: []evaluator.Violation{{
				Rule:    "request",
				Code:    "VALIDATION_ERROR",
				Message: "Estimated monthly cost cannot be negative.",
			}},
		})
		return
	}

	if req.Manifest.Tags == nil {
		req.Manifest.Tags = map[string]string{}
	}

	organizationPolicy, err := h.repository.GetOrganizationPolicy(r.Context(), req.OrgID)
	if err != nil {
		status := http.StatusInternalServerError
		code := "POLICY_CONFIGURATION_FAILED"
		message := "Failed to load organization policy."
		if errors.Is(err, repository.ErrPolicyNotFound) {
			status = http.StatusNotFound
			code = "POLICY_NOT_CONFIGURED"
			message = "Organization policy was not found or is incomplete."
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Passed: false,
			Violations: []evaluator.Violation{{
				Rule:    "organization_policy",
				Code:    code,
				Message: message,
			}},
		})
		return
	}

	input := struct {
		OrgID            string   `json:"org_id"`
		MonthlyBudgetUSD float64  `json:"monthly_budget_usd"`
		AllowedRegions   []string `json:"allowed_regions"`
		RequiredTags     []string `json:"required_tags"`
		Manifest         Manifest `json:"manifest"`
	}{
		OrgID:            req.OrgID,
		MonthlyBudgetUSD: organizationPolicy.MonthlyBudgetUSD,
		AllowedRegions:   organizationPolicy.AllowedRegions,
		RequiredTags:     organizationPolicy.RequiredTags,
		Manifest:         req.Manifest,
	}

	result, err := h.evaluator.Evaluate(r.Context(), input)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)

		_ = json.NewEncoder(w).Encode(EvaluateResponse{
			Passed: false,
			Violations: []evaluator.Violation{
				{
					Rule:    "policy_engine",
					Code:    "POLICY_EVALUATION_FAILED",
					Message: "Policy evaluation failed.",
				},
			},
		})
		return
	}

	response := EvaluateResponse{
		Passed:     result.Passed,
		Violations: result.Violations,
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}
