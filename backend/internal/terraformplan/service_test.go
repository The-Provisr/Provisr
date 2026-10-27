package terraformplan

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/provisr/backend/internal/manifest"
)

func request() Request {
	return Request{ArtifactID: uuid.NewString(), Context: manifest.Context{WorkspaceID: uuid.NewString(), UserID: uuid.NewString(), SessionID: uuid.NewString(), RequestID: uuid.NewString(), CorrelationID: uuid.NewString(), Permissions: []string{"iac:write"}, IdempotencyKey: "plan-test"}}
}

type fakePlanner struct {
	calls int
	err   error
}

func (p *fakePlanner) Create(_ context.Context, r Request) (*Result, error) {
	p.calls++
	return &Result{ID: uuid.NewString(), ArtifactID: r.ArtifactID}, p.err
}

func TestHTTPAuthorizationAndInputBeforePlanning(t *testing.T) {
	for _, tc := range []struct {
		name, auth string
		mutate     func(map[string]any)
		status     int
	}{
		{"no auth", "", nil, 401}, {"wrong auth", "Bearer wrong", nil, 401},
		{"unprivileged", "Bearer test", func(m map[string]any) { m["context"].(map[string]any)["permissions"] = []string{} }, 400},
		{"missing key", "Bearer test", func(m map[string]any) { m["context"].(map[string]any)["idempotency_key"] = " " }, 400},
		{"injected terraform", "Bearer test", func(m map[string]any) { m["files"] = "untrusted" }, 400},
		{"zero artifact", "Bearer test", func(m map[string]any) { m["iac_artifact_id"] = uuid.Nil.String() }, 400},
		{"valid", "Bearer test", nil, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := request()
			raw, _ := json.Marshal(r)
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			if tc.mutate != nil {
				tc.mutate(body)
			}
			raw, _ = json.Marshal(body)
			p := &fakePlanner{}
			req := httptest.NewRequest("POST", "/v1/iac/plans", bytes.NewReader(raw))
			req.Header.Set("Authorization", tc.auth)
			w := httptest.NewRecorder()
			NewHandler(p, "test").ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.status != 200 && p.calls != 0 {
				t.Fatal("unauthorized planning")
			}
		})
	}
}

func TestHTTPNeverReturnsProviderError(t *testing.T) {
	r := request()
	raw, _ := json.Marshal(r)
	p := &fakePlanner{err: errors.New("secret credential provider diagnostic")}
	req := httptest.NewRequest("POST", "/v1/iac/plans", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer test")
	w := httptest.NewRecorder()
	NewHandler(p, "test").ServeHTTP(w, req)
	if w.Code != 503 || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("unsafe error: %s", w.Body.String())
	}
}
