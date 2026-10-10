package policy

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestEngine_Evaluate_Allow(t *testing.T) {
	engine := NewEngine()
	ctx := context.Background()

	input := map[string]any{
		"region": "us-east-1",
		"resources": []any{
			map[string]any{
				"id":   "safe_bucket",
				"type": "aws_s3_bucket",
				"properties": map[string]any{
					"acl":                        "private",
					"encrypted":                  true,
					"public_access_block_enabled": true,
				},
				"tags": map[string]any{
					"Environment": "production",
					"Owner":       "platform-team",
				},
			},
			map[string]any{
				"id":   "db_storage",
				"type": "aws_ebs_volume",
				"properties": map[string]any{
					"encrypted": true,
				},
				"tags": map[string]any{
					"Environment": "production",
					"Owner":       "platform-team",
				},
			},
		},
		"estimated_monthly_cost_usd": 150.0,
	}

	res, err := engine.Evaluate(ctx, EvaluationRequest{
		CheckType: "manifest",
		Input:     input,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if res.Decision != DecisionAllow {
		t.Fatalf("expected decision %s, got %s (violations: %+v)", DecisionAllow, res.Decision, res.Violations)
	}
	if len(res.Violations) != 0 {
		t.Fatalf("expected 0 violations, got %d", len(res.Violations))
	}
	if res.PoliciesEvaluated < 6 {
		t.Fatalf("expected at least 6 policies evaluated, got %d", res.PoliciesEvaluated)
	}
}

func TestEngine_Evaluate_DenyRules(t *testing.T) {
	engine := NewEngine()
	ctx := context.Background()

	tests := []struct {
		name            string
		input           map[string]any
		expectedRuleKey string
	}{
		{
			name: "public S3 bucket denied",
			input: map[string]any{
				"region": "us-east-1",
				"resources": []any{
					map[string]any{
						"id":   "public_bucket",
						"type": "aws_s3_bucket",
						"properties": map[string]any{
							"acl":       "public-read",
							"encrypted": true,
						},
						"tags": map[string]any{"Environment": "prod", "Owner": "team"},
					},
				},
			},
			expectedRuleKey: "security.no_public_s3",
		},
		{
			name: "unencrypted storage denied",
			input: map[string]any{
				"region": "us-east-1",
				"resources": []any{
					map[string]any{
						"id":   "unencrypted_ebs",
						"type": "aws_ebs_volume",
						"properties": map[string]any{
							"encrypted": false,
						},
						"tags": map[string]any{"Environment": "prod", "Owner": "team"},
					},
				},
			},
			expectedRuleKey: "security.require_encryption",
		},
		{
			name: "IAM policy wildcard action denied",
			input: map[string]any{
				"region": "us-east-1",
				"resources": []any{
					map[string]any{
						"id":   "wildcard_policy",
						"type": "aws_iam_policy",
						"properties": map[string]any{
							"statement": []any{
								map[string]any{
									"actions": []any{"*"},
									"effect":  "Allow",
								},
							},
						},
					},
				},
			},
			expectedRuleKey: "security.iam_no_wildcards",
		},
		{
			name: "unapproved region denied",
			input: map[string]any{
				"region": "ap-south-1", // not in allowed list
				"resources": []any{
					map[string]any{
						"id":   "vol",
						"type": "aws_ebs_volume",
						"properties": map[string]any{
							"encrypted": true,
						},
						"tags": map[string]any{"Environment": "prod", "Owner": "team"},
					},
				},
			},
			expectedRuleKey: "compliance.allowed_regions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := engine.Evaluate(ctx, EvaluationRequest{
				CheckType: "manifest",
				Input:     tt.input,
			})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if res.Decision != DecisionDeny {
				t.Fatalf("expected decision %s, got %s (violations: %+v)", DecisionDeny, res.Decision, res.Violations)
			}
			found := false
			for _, v := range res.Violations {
				if v.RuleKey == tt.expectedRuleKey && v.Severity == SeverityDeny {
					found = true
					if v.Evidence == "" || v.RemediationHint == "" {
						t.Fatalf("violation missing evidence or remediation hint: %+v", v)
					}
					break
				}
			}
			if !found {
				t.Fatalf("expected violation for rule %s, got %+v", tt.expectedRuleKey, res.Violations)
			}
		})
	}
}

func TestEngine_Evaluate_WarnAndApproval(t *testing.T) {
	engine := NewEngine()
	ctx := context.Background()

	// 1. Missing required tags produces WARN
	t.Run("missing required tags yields WARN", func(t *testing.T) {
		input := map[string]any{
			"region": "us-east-1",
			"resources": []any{
				map[string]any{
					"id":   "clean_vol",
					"type": "aws_ebs_volume",
					"properties": map[string]any{
						"encrypted": true,
					},
					"tags": map[string]any{
						"Environment": "dev",
						// Missing "Owner"
					},
				},
			},
		}

		res, err := engine.Evaluate(ctx, EvaluationRequest{
			CheckType: "manifest",
			Input:     input,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Decision != DecisionWarn {
			t.Fatalf("expected decision %s, got %s", DecisionWarn, res.Decision)
		}
	})

	// 2. Budget moderate overrun yields WARN
	t.Run("budget moderate overrun yields WARN", func(t *testing.T) {
		input := map[string]any{
			"region": "us-east-1",
			"resources": []any{
				map[string]any{
					"id":   "clean_vol",
					"type": "aws_ebs_volume",
					"properties": map[string]any{
						"encrypted": true,
					},
					"tags": map[string]any{
						"Environment": "dev",
						"Owner":       "test",
					},
				},
			},
			"estimated_monthly_cost_usd": 1200.0, // default budget 1000
		}

		res, err := engine.Evaluate(ctx, EvaluationRequest{
			CheckType: "manifest",
			Input:     input,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Decision != DecisionWarn {
			t.Fatalf("expected decision %s, got %s", DecisionWarn, res.Decision)
		}
	})

	// 3. Budget severe overrun yields REQUIRES_APPROVAL
	t.Run("budget severe overrun yields REQUIRES_APPROVAL", func(t *testing.T) {
		input := map[string]any{
			"region": "us-east-1",
			"resources": []any{
				map[string]any{
					"id":   "clean_vol",
					"type": "aws_ebs_volume",
					"properties": map[string]any{
						"encrypted": true,
					},
					"tags": map[string]any{
						"Environment": "dev",
						"Owner":       "test",
					},
				},
			},
			"estimated_monthly_cost_usd": 2500.0, // >= 2x budget 1000
		}

		res, err := engine.Evaluate(ctx, EvaluationRequest{
			CheckType: "manifest",
			Input:     input,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Decision != DecisionRequiresApproval {
			t.Fatalf("expected decision %s, got %s", DecisionRequiresApproval, res.Decision)
		}
	})
}

func TestEngine_Evaluate_TerraformPlanJSON(t *testing.T) {
	engine := NewEngine()
	ctx := context.Background()

	planInput := map[string]any{
		"resource_changes": []any{
			map[string]any{
				"type": "aws_s3_bucket",
				"name": "terraform_bucket",
				"change": map[string]any{
					"after": map[string]any{
						"acl":       "public-read",
						"encrypted": true,
						"tags": map[string]any{
							"Environment": "staging",
							"Owner":       "devops",
						},
					},
				},
			},
		},
	}

	res, err := engine.Evaluate(ctx, EvaluationRequest{
		CheckType: "plan",
		Input:     planInput,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if res.Decision != DecisionDeny {
		t.Fatalf("expected decision %s, got %s", DecisionDeny, res.Decision)
	}
	if len(res.Violations) == 0 || res.Violations[0].RuleKey != "security.no_public_s3" {
		t.Fatalf("expected security.no_public_s3 violation, got %+v", res.Violations)
	}
}

func BenchmarkEngine_Evaluate(b *testing.B) {
	engine := NewEngine()
	ctx := context.Background()

	req := EvaluationRequest{
		CheckType: "manifest",
		Input: map[string]any{
			"region": "us-east-1",
			"resources": []any{
				map[string]any{
					"id":   "test_vol",
					"type": "aws_ebs_volume",
					"properties": map[string]any{
						"encrypted": true,
					},
					"tags": map[string]any{
						"Environment": "production",
						"Owner":       "infra",
					},
				},
			},
			"estimated_monthly_cost_usd": 500.0,
		},
	}

	start := time.Now()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = engine.Evaluate(ctx, req)
	}
	elapsed := time.Since(start)
	if b.N > 0 {
		avgPerOp := elapsed / time.Duration(b.N)
		if avgPerOp > 500*time.Millisecond {
			b.Fatalf("evaluation per op too slow: %v > 500ms", avgPerOp)
		}
	}
}

func TestHandleEvaluatePolicy_Endpoint(t *testing.T) {
	handler := New(nil, zerolog.Nop())

	validReq := EvaluationRequest{
		WorkspaceID: uuid.New().String(),
		CheckType:   "manifest",
		Input: map[string]any{
			"region": "us-east-1",
			"resources": []any{
				map[string]any{
					"id":   "clean_bucket",
					"type": "aws_s3_bucket",
					"properties": map[string]any{
						"acl":       "private",
						"encrypted": true,
					},
					"tags": map[string]any{
						"Environment": "prod",
						"Owner":       "secops",
					},
				},
			},
		},
	}
	bodyBytes, _ := json.Marshal(validReq)

	req := httptest.NewRequest(http.MethodPost, "/v1/policies/evaluate", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp EvaluationResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Decision != DecisionAllow {
		t.Fatalf("expected decision ALLOW, got %s", resp.Decision)
	}
}
