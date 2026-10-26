package statebackend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeEnsurer struct {
	input  Request
	called bool
	err    error
}

func (f *fakeEnsurer) Ensure(_ context.Context, r Request) (*Result, error) {
	f.called, f.input = true, r
	if f.err != nil {
		return nil, f.err
	}
	return &Result{ID: "backend", Provider: r.Provider, Status: "ready", VerifiedAt: time.Unix(0, 0).UTC()}, nil
}

func validBody() map[string]any {
	return map[string]any{"provider": "AWS", "context": map[string]any{"workspace_id": strings.ToUpper(workspace), "user_id": run,
		"correlation_id": otherWS, "idempotency_key": "ensure-1", "permissions": []string{"iac:write"}}}
}

func post(t *testing.T, e Ensurer, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest("POST", "/v1/state-backends/ensure", strings.NewReader(string(raw)))
	r.Header.Set("Authorization", token)
	w := httptest.NewRecorder()
	NewHandler(e, "test-token").ServeHTTP(w, r)
	return w
}

func TestEnsureRouteRequiresServiceToken(t *testing.T) {
	for _, token := range []string{"", "Bearer wrong", "test-token"} {
		e := &fakeEnsurer{}
		if w := post(t, e, token, validBody()); w.Code != 401 || e.called {
			t.Fatalf("token %q: status %d", token, w.Code)
		}
	}
	e := &fakeEnsurer{}
	raw, _ := json.Marshal(validBody())
	r := httptest.NewRequest("POST", "/v1/state-backends/ensure", strings.NewReader(string(raw)))
	r.Header.Set("Authorization", "Bearer ")
	w := httptest.NewRecorder()
	NewHandler(e, "").ServeHTTP(w, r)
	if w.Code != 401 || e.called {
		t.Fatal("missing configured token must fail closed")
	}
}

func TestEnsureRouteValidatesAndCanonicalizes(t *testing.T) {
	e := &fakeEnsurer{}
	w := post(t, e, "Bearer test-token", validBody())
	if w.Code != 200 || e.input.Provider != "aws" || e.input.Context.WorkspaceID != workspace {
		t.Fatalf("status %d input %+v", w.Code, e.input)
	}
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	for key := range got {
		if key != "state_backend_id" && key != "provider" && key != "status" && key != "created" && key != "verified_at" {
			t.Fatalf("response exposes %q", key)
		}
	}
	for name, mutate := range map[string]func(map[string]any){
		"provider":   func(b map[string]any) { b["provider"] = "oci" },
		"permission": func(b map[string]any) { b["context"].(map[string]any)["permissions"] = []string{"iac:read"} },
		"key":        func(b map[string]any) { b["context"].(map[string]any)["idempotency_key"] = " " },
		"workspace":  func(b map[string]any) { b["context"].(map[string]any)["workspace_id"] = "nope" },
		"unknown":    func(b map[string]any) { b["bucket"] = "attacker-bucket" },
	} {
		body := validBody()
		mutate(body)
		e := &fakeEnsurer{}
		if w := post(t, e, "Bearer test-token", body); w.Code != 400 || e.called {
			t.Fatalf("%s: status %d", name, w.Code)
		}
	}
}

func TestEnsureRouteMapsFailuresGenerically(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{errNotOnboard, 422, "provider_not_onboarded"},
		{errConflict, 409, "backend_conflict"},
		{errUnavailable, 502, "backend_unavailable"},
		{errors.New("pq: password authentication failed for provisr"), 503, "unavailable"},
	} {
		w := post(t, &fakeEnsurer{err: tc.err}, "Bearer test-token", validBody())
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "pq:") {
			t.Fatalf("%v: %d %s", tc.err, w.Code, w.Body.String())
		}
	}
}
