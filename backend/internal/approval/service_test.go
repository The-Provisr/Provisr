package approval

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/provisr/backend/pkg/middleware"
)

const testToken = "svc-token"

type fakeStore struct {
	ctx       EvaluationContext
	loadErr   error
	recordErr error
	records   []AuditRecord
	loadedFor [2]string
}

func (f *fakeStore) LoadEvaluationContext(_ context.Context, workspaceID, userID string) (EvaluationContext, error) {
	f.loadedFor = [2]string{workspaceID, userID}
	return f.ctx, f.loadErr
}

func (f *fakeStore) RecordEvaluation(_ context.Context, rec AuditRecord) error {
	if f.recordErr != nil {
		return f.recordErr
	}
	f.records = append(f.records, rec)
	return nil
}

func newFakeStore() *fakeStore {
	return &fakeStore{ctx: EvaluationContext{WorkspaceEnvironment: "dev", UserRole: "engineer", Config: DefaultConfig()}}
}

const validBody = `{
  "workspace_id": "11111111-1111-1111-1111-111111111111",
  "run_id": "33333333-3333-3333-3333-333333333333",
  "user_id": "22222222-2222-2222-2222-222222222222",
  "environment": "prod",
  "provider": "aws",
  "region": "us-east-1",
  "resource_changes": [{"address": "aws_s3_bucket.logs", "type": "aws_s3_bucket", "action": "create",
                        "properties": {"secret_like": "do-not-audit"}}],
  "cost_estimate": {"estimated_monthly_usd": 120, "source": "manifest_estimate"},
  "policy": {"decision": "ALLOW", "violations": []}
}`

func post(t *testing.T, h http.Handler, auth, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requirements/evaluate", strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func decodeError(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	return body.Error
}

func TestEvaluateEndpointRequiresServiceToken(t *testing.T) {
	store := newFakeStore()
	if w := post(t, NewHandler(store, middleware.New("test"), ""), "Bearer anything", validBody); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unset token: expected 503, got %d", w.Code)
	}
	h := NewHandler(store, middleware.New("test"), testToken)
	for _, auth := range []string{"", "Bearer wrong", testToken} {
		if w := post(t, h, auth, validBody); w.Code != http.StatusUnauthorized {
			t.Fatalf("auth %q: expected 401, got %d", auth, w.Code)
		}
	}
	if len(store.records) != 0 {
		t.Fatal("unauthenticated requests must not be audited")
	}
}

func TestEvaluateEndpointReturnsAuditedDecision(t *testing.T) {
	store := newFakeStore()
	h := NewHandler(store, middleware.New("test"), testToken)
	w := post(t, h, "Bearer "+testToken, validBody)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp EvaluateResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if !resp.RequiresApproval || resp.RequiredApproverRole == nil || *resp.RequiredApproverRole != ApproverAdmin || resp.RiskLevel != RiskHigh {
		t.Fatalf("unexpected decision: %+v", resp)
	}
	if resp.EvaluationID == "" || resp.EvaluatedAt == "" || resp.InputDigest == "" {
		t.Fatalf("missing audit identity: %+v", resp)
	}
	if store.loadedFor != [2]string{"11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"} {
		t.Fatalf("context loaded for %v", store.loadedFor)
	}

	if len(store.records) != 1 {
		t.Fatalf("expected one audit record, got %d", len(store.records))
	}
	rec := store.records[0]
	if rec.ResourceID != "33333333-3333-3333-3333-333333333333" || rec.EvaluationID != resp.EvaluationID {
		t.Fatalf("audit record identity: %+v", rec)
	}
	if rec.Payload["input_digest"] != resp.InputDigest || rec.Payload["rule_set_version"] != RuleSetVersion {
		t.Fatalf("audit payload provenance: %+v", rec.Payload)
	}
	raw, _ := json.Marshal(rec.Payload)
	if strings.Contains(string(raw), "do-not-audit") {
		t.Fatal("raw resource properties leaked into audit payload")
	}
}

func TestEvaluateEndpointUsesServerResolvedRole(t *testing.T) {
	store := newFakeStore()
	store.ctx.UserRole = "viewer"
	body := strings.Replace(validBody, `"environment": "prod"`, `"environment": "dev"`, 1)
	w := post(t, NewHandler(store, middleware.New("test"), testToken), "Bearer "+testToken, body)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp EvaluateResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if !resp.RequiresApproval || resp.TriggeredRules[0].Rule != RuleRole {
		t.Fatalf("expected role rule from stored membership, got %+v", resp)
	}
}

func TestEvaluateEndpointErrors(t *testing.T) {
	tests := []struct {
		name   string
		store  func(*fakeStore)
		body   string
		status int
		code   string
	}{
		{"invalid json", nil, `{`, http.StatusBadRequest, "invalid_json"},
		{"unknown field", nil, strings.Replace(validBody, `"provider"`, `"user_role": "admin", "provider"`, 1), http.StatusBadRequest, "invalid_json"},
		{"bad workspace", nil, strings.Replace(validBody, "11111111-1111-1111-1111-111111111111", "nope", 1), http.StatusBadRequest, "validation_error"},
		{"bad user", nil, strings.Replace(validBody, "22222222-2222-2222-2222-222222222222", "nope", 1), http.StatusBadRequest, "validation_error"},
		{"bad run", nil, strings.Replace(validBody, "33333333-3333-3333-3333-333333333333", "nope", 1), http.StatusBadRequest, "validation_error"},
		{"rule validation", nil, strings.Replace(validBody, `"environment": "prod"`, `"environment": "moon"`, 1), http.StatusBadRequest, "validation_error"},
		{"policy denied", nil, strings.Replace(validBody, `"ALLOW"`, `"DENY"`, 1), http.StatusConflict, "policy_denied"},
		{"not a member", func(f *fakeStore) { f.loadErr = ErrNotMember }, validBody, http.StatusNotFound, "not_found"},
		{"invalid config", func(f *fakeStore) { f.loadErr = ErrInvalidConfig }, validBody, http.StatusInternalServerError, "invalid_approval_config"},
		{"store failure", func(f *fakeStore) { f.loadErr = errors.New("db down") }, validBody, http.StatusInternalServerError, "internal_error"},
		{"audit failure fails closed", func(f *fakeStore) { f.recordErr = errors.New("chain lock") }, validBody, http.StatusInternalServerError, "internal_error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newFakeStore()
			if tt.store != nil {
				tt.store(store)
			}
			w := post(t, NewHandler(store, middleware.New("test"), testToken), "Bearer "+testToken, tt.body)
			if w.Code != tt.status {
				t.Fatalf("expected %d, got %d: %s", tt.status, w.Code, w.Body.String())
			}
			if code := decodeError(t, w); code != tt.code {
				t.Fatalf("expected error %q, got %q", tt.code, code)
			}
		})
	}
}

func TestParseConfig(t *testing.T) {
	tests := []struct {
		raw     sql.NullString
		want    float64
		wantErr bool
	}{
		{sql.NullString{}, DefaultCostThresholdUSD, false},
		{sql.NullString{String: "null", Valid: true}, DefaultCostThresholdUSD, false},
		{sql.NullString{String: "1200", Valid: true}, 1200, false},
		{sql.NullString{String: "0", Valid: true}, 0, false},
		{sql.NullString{String: "-1", Valid: true}, 0, true},
		{sql.NullString{String: `"500"`, Valid: true}, 0, true},
	}
	for _, tt := range tests {
		got, err := parseConfig(tt.raw)
		if tt.wantErr {
			if !errors.Is(err, ErrInvalidConfig) {
				t.Fatalf("%v: expected ErrInvalidConfig, got %v", tt.raw, err)
			}
			continue
		}
		if err != nil || got.CostThresholdUSD != tt.want {
			t.Fatalf("%v: got %v, %v", tt.raw, got, err)
		}
	}
}
