package evaluator

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/open-policy-agent/opa/v1/rego"
)

type Violation struct {
	Rule    string `json:"rule"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type EvaluationResult struct {
	Passed     bool        `json:"passed"`
	Violations []Violation `json:"violations"`
}

type Evaluator struct {
	query rego.PreparedEvalQuery
}

func New(ctx context.Context) (*Evaluator, error) {
	policyBytes, err := os.ReadFile("policies/base.rego")
	if err != nil {
		return nil, fmt.Errorf("read base policy: %w", err)
	}
	return NewFromSource(ctx, string(policyBytes))
}

func NewFromSource(ctx context.Context, policySource string) (*Evaluator, error) {
	r := rego.New(
		rego.Query("data.provisr.policy.violations"),
		rego.Module("base.rego", policySource),
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

	data, err := json.Marshal(results[0].Expressions[0].Value)
	if err != nil {
		return EvaluationResult{}, fmt.Errorf("marshal policy result: %w", err)
	}

	violations := make([]Violation, 0)
	if err := json.Unmarshal(data, &violations); err != nil {
		return EvaluationResult{}, fmt.Errorf("decode policy violations: %w", err)
	}

	return EvaluationResult{
		Passed:     len(violations) == 0,
		Violations: violations,
	}, nil
}
