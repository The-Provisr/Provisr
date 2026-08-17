package policy

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPolicyRequirementsSerialization(t *testing.T) {
	// Case 1: No budget rule (nil pointer)
	reqsNoBudget := PolicyRequirements{
		AllowedRegions: []string{"us-east-1"},
	}
	bytesNoBudget, err := json.Marshal(reqsNoBudget)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	if strings.Contains(string(bytesNoBudget), "max_monthly_budget_usd") {
		t.Fatalf("expected max_monthly_budget_usd to be omitted when nil, got: %s", string(bytesNoBudget))
	}

	// Case 2: Zero budget ($0)
	zero := 0.0
	reqsZeroBudget := PolicyRequirements{
		AllowedRegions:      []string{"us-east-1"},
		MaxMonthlyBudgetUSD: &zero,
	}
	bytesZeroBudget, err := json.Marshal(reqsZeroBudget)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	if !strings.Contains(string(bytesZeroBudget), `"max_monthly_budget_usd":0`) {
		t.Fatalf("expected max_monthly_budget_usd:0 to be present for zero budget, got: %s", string(bytesZeroBudget))
	}

	// Case 3: Positive budget ($500)
	budget500 := 500.0
	reqsPositiveBudget := PolicyRequirements{
		MaxMonthlyBudgetUSD: &budget500,
	}
	bytesPositiveBudget, err := json.Marshal(reqsPositiveBudget)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	if !strings.Contains(string(bytesPositiveBudget), `"max_monthly_budget_usd":500`) {
		t.Fatalf("expected max_monthly_budget_usd:500 to be present, got: %s", string(bytesPositiveBudget))
	}
}

func TestContainsHelper(t *testing.T) {
	slice := []string{"tag1", "tag2"}
	if !contains(slice, "tag1") {
		t.Fatal("expected true for tag1")
	}
	if contains(slice, "tag3") {
		t.Fatal("expected false for tag3")
	}
}

