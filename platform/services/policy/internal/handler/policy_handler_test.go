package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/provisr/platform/services/policy/internal/evaluator"
	"github.com/provisr/platform/services/policy/internal/repository"
)

type fakeEvaluator struct {
	result evaluator.EvaluationResult
	err    error
}

func (f fakeEvaluator) Evaluate(context.Context, any) (evaluator.EvaluationResult, error) {
	return f.result, f.err
}

type fakeRepository struct {
	policy repository.OrganizationPolicy
	err    error
}

func (f fakeRepository) GetOrganizationPolicy(context.Context, string) (repository.OrganizationPolicy, error) {
	return f.policy, f.err
}

func TestEvaluatePolicyResponseContract(t *testing.T) {
	tests := []struct {
		name       string
		result     evaluator.EvaluationResult
		wantPassed bool
		wantCode   string
	}{
		{
			name:       "valid manifest",
			result:     evaluator.EvaluationResult{Passed: true, Violations: []evaluator.Violation{}},
			wantPassed: true,
		},
		{
			name: "over budget",
			result: evaluator.EvaluationResult{Passed: false, Violations: []evaluator.Violation{{
				Rule: "monthly_budget_usd", Code: "BUDGET_EXCEEDED", Message: "monthly_budget_usd rule failed",
			}}},
			wantCode: "BUDGET_EXCEEDED",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewPolicyHandler(fakeEvaluator{result: tt.result}, fakeRepository{policy: repository.OrganizationPolicy{
				MonthlyBudgetUSD: 1000,
				AllowedRegions:   []string{"us-east-1"},
				RequiredTags:     []string{"owner"},
			}})
			body := []byte(`{"org_id":"00000000-0000-0000-0000-000000000001","manifest":{"provider":"aws","region":"us-east-1","estimated_monthly_cost_usd":750,"tags":{"owner":"team"}}}`)
			req := httptest.NewRequest(http.MethodPost, "/v1/policy/evaluate", bytes.NewReader(body))
			res := httptest.NewRecorder()

			h.EvaluatePolicy(res, req)
			if res.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
			}

			var got EvaluateResponse
			if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.Passed != tt.wantPassed {
				t.Fatalf("passed = %v, want %v", got.Passed, tt.wantPassed)
			}
			if tt.wantCode != "" && (len(got.Violations) != 1 || got.Violations[0].Code != tt.wantCode) {
				t.Fatalf("violations = %+v, want code %s", got.Violations, tt.wantCode)
			}
			if tt.wantPassed && got.Violations == nil {
				t.Fatal("violations must be an empty array, not null")
			}
		})
	}
}

func TestEvaluatePolicyRejectsInvalidJSON(t *testing.T) {
	h := NewPolicyHandler(fakeEvaluator{}, fakeRepository{})
	req := httptest.NewRequest(http.MethodPost, "/v1/policy/evaluate", bytes.NewBufferString("{"))
	res := httptest.NewRecorder()

	h.EvaluatePolicy(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusBadRequest)
	}
}

func TestEvaluatePolicyOverBudgetIntegration(t *testing.T) {
	policySource, err := os.ReadFile("../../policies/base.rego")
	if err != nil {
		t.Fatalf("read policy: %v", err)
	}
	policyEvaluator, err := evaluator.NewFromSource(context.Background(), string(policySource))
	if err != nil {
		t.Fatalf("prepare evaluator: %v", err)
	}

	h := NewPolicyHandler(policyEvaluator, fakeRepository{policy: repository.OrganizationPolicy{
		MonthlyBudgetUSD: 1000,
		AllowedRegions:   []string{"us-east-1"},
		RequiredTags:     []string{"owner"},
	}})
	body := []byte(`{"org_id":"00000000-0000-0000-0000-000000000001","manifest":{"provider":"aws","region":"us-east-1","estimated_monthly_cost_usd":1200,"tags":{"owner":"team"}}}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/policy/evaluate", bytes.NewReader(body))
	res := httptest.NewRecorder()

	h.EvaluatePolicy(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}

	var got EvaluateResponse
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Passed || len(got.Violations) != 1 {
		t.Fatalf("expected one denial violation, got %+v", got)
	}
	if got.Violations[0].Rule != "monthly_budget_usd" || got.Violations[0].Code != "BUDGET_EXCEEDED" {
		t.Fatalf("unexpected violation: %+v", got.Violations[0])
	}
}
