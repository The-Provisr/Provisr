package evaluator

import (
	"context"
	"fmt"
	"os"

	"github.com/open-policy-agent/opa/v1/rego"
)

type EvaluationResult struct {
	Allowed    bool     `json:"allowed"`
	Decision   string   `json:"decision"`
	Violations []string `json:"violations"`
}

type Evaluator struct {
	query rego.PreparedEvalQuery
}

func New(ctx context.Context) (*Evaluator, error) {
	policyBytes, err := os.ReadFile("policies/base.rego")
	if err != nil {
		return nil, fmt.Errorf("read base policy: %w", err)
	}

	r := rego.New(
		rego.Query("data.provisr.policy"),
		rego.Module("base.rego", string(policyBytes)),
	)

	query, err := r.PrepareForEval(ctx)
	if err != nil {
		return nil, fmt.Errorf("prepare policy query: %w", err)
	}

	return &Evaluator{
		query: query,
	}, nil
}

func (e *Evaluator) Evaluate(ctx context.Context, input any) (EvaluationResult, error) {
	results, err := e.query.Eval(ctx, rego.EvalInput(input))
	if err != nil {
		return EvaluationResult{}, fmt.Errorf("evaluate policy: %w", err)
	}

	if len(results) == 0 || len(results[0].Expressions) == 0 {
		return EvaluationResult{}, fmt.Errorf("policy returned no result")
	}

	value, ok := results[0].Expressions[0].Value.(map[string]any)
	if !ok {
		return EvaluationResult{}, fmt.Errorf("unexpected policy result format")
	}

	denyValues, _ := value["deny"].([]any)

	violations := make([]string, 0, len(denyValues))
	for _, item := range denyValues {
		violationMap, ok := item.(map[string]any)
		if !ok {
			violations = append(violations, fmt.Sprint(item))
			continue
		}

		code, _ := violationMap["code"].(string)
		message, _ := violationMap["message"].(string)

		if code != "" && message != "" {
			violations = append(violations, fmt.Sprintf("%s: %s", code, message))
		} else {
			violations = append(violations, fmt.Sprint(item))
		}
	}

	allowed := len(violations) == 0
	decision := "deny"
	if allowed {
		decision = "allow"
	}

	return EvaluationResult{
		Allowed:    allowed,
		Decision:   decision,
		Violations: violations,
	}, nil
}
