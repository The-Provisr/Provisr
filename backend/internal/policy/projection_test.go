package policy

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPolicyRequirementsSerialization(t *testing.T) {
	// Case 1: No budget rule (nil pointer)
	regions := []string{"us-east-1"}
	reqsNoBudget := PolicyRequirements{
		AllowedRegions: &regions,
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
		AllowedRegions:      &regions,
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

func TestAllowedRegionsSerializationDistinguishesNoRuleFromEmptyRule(t *testing.T) {
	noRule, err := json.Marshal(PolicyRequirements{})
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	if strings.Contains(string(noRule), "allowed_regions") {
		t.Fatalf("expected allowed_regions to be omitted without a rule, got: %s", noRule)
	}

	empty := []string{}
	emptyRule, err := json.Marshal(PolicyRequirements{AllowedRegions: &empty})
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	if !strings.Contains(string(emptyRule), `"allowed_regions":[]`) {
		t.Fatalf("expected allowed_regions:[] for an enabled rule with no regions, got: %s", emptyRule)
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

