package iacartifact

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/provisr/backend/internal/manifest"
)

type fakeGenerator struct{ called bool }

func (g *fakeGenerator) Generate(_ context.Context, r Request) (*Artifact, error) {
	g.called = true
	return &Artifact{ManifestID: r.ManifestID}, nil
}
func request() Request {
	return Request{ManifestID: uuid.NewString(), Context: manifest.Context{WorkspaceID: uuid.NewString(), UserID: uuid.NewString(), RequestID: uuid.NewString(), SessionID: uuid.NewString(), CorrelationID: uuid.NewString(), IdempotencyKey: "generation-1", Permissions: []string{"iac:write"}}}
}
func TestPrivateEndpointRejectsUntrustedInputBeforeStorage(t *testing.T) {
	valid := request()
	data, _ := json.Marshal(valid)
	for _, tc := range []struct {
		token, body string
		status      int
	}{
		{"", string(data), 401}, {"wrong", string(data), 401}, {"test-token", "{}", 400},
		{"test-token", string(data) + " {}", 400}, {"test-token", `{"content":{}}`, 400},
		{"test-token", string(data), 200},
	} {
		g := &fakeGenerator{}
		h := NewHandler(g, "test-token")
		r := httptest.NewRequest("POST", "/v1/iac/generate", strings.NewReader(tc.body))
		r.Header.Set("Authorization", "Bearer "+tc.token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status || g.called != (tc.status == 200) {
			t.Fatalf("status %d; body %s", w.Code, w.Body.String())
		}
	}
	valid.Context.Permissions = []string{"manifest:read"}
	if validRequest(valid) {
		t.Fatal("write permission not enforced")
	}
	valid = request()
	valid.Context.IdempotencyKey = " "
	if validRequest(valid) {
		t.Fatal("empty key accepted")
	}
}
