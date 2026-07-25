package evaluator

import (
	"context"
	"os"
	"testing"
)

func TestEvaluate(t *testing.T) {
	policySource, err := os.ReadFile("../../policies/base.rego")
	if err != nil {
		t.Fatalf("read policy: %v", err)
	}

	e, err := NewFromSource(context.Background(), string(policySource))
	if err != nil {
		t.Fatalf("prepare evaluator: %v", err)
	}

	validInput := map[string]any{
		"org_id":             "00000000-0000-0000-0000-000000000001",
		"monthly_budget_usd": 1000.0,
		"allowed_regions":    []string{"us-east-1"},
		"required_tags":      []string{"owner"},
		"manifest": map[string]any{
			"provider":                   "aws",
			"region":                     "us-east-1",
			"estimated_monthly_cost_usd": 750.0,
			"tags":                       map[string]string{"owner": "platform-team"},
		},
	}

	t.Run("valid manifest passes", func(t *testing.T) {
		result, err := e.Evaluate(context.Background(), validInput)
		if err != nil {
			t.Fatalf("evaluate: %v", err)
		}
		if !result.Passed || len(result.Violations) != 0 {
			t.Fatalf("expected pass with no violations, got %+v", result)
		}
	})

	t.Run("over budget names budget rule", func(t *testing.T) {
		input := cloneInput(validInput)
		input["manifest"].(map[string]any)["estimated_monthly_cost_usd"] = 1200.0

		result, err := e.Evaluate(context.Background(), input)
		if err != nil {
			t.Fatalf("evaluate: %v", err)
		}
		if result.Passed || len(result.Violations) != 1 {
			t.Fatalf("expected one violation, got %+v", result)
		}
		if result.Violations[0].Rule != "monthly_budget_usd" || result.Violations[0].Code != "BUDGET_EXCEEDED" {
			t.Fatalf("unexpected violation: %+v", result.Violations[0])
		}
	})
}

func cloneInput(input map[string]any) map[string]any {
	cloned := make(map[string]any, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	manifest := input["manifest"].(map[string]any)
	clonedManifest := make(map[string]any, len(manifest))
	for key, value := range manifest {
		clonedManifest[key] = value
	}
	cloned["manifest"] = clonedManifest
	return cloned
}
