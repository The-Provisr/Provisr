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

type fakeGenerator struct {
	called bool
	input  Request
}

func (g *fakeGenerator) Generate(_ context.Context, r Request) (*Artifact, error) {
	g.called = true
	g.input = r
	return &Artifact{ManifestID: r.ManifestID}, nil
}

func alternateUUIDs(r Request, format func(string) string) Request {
	for _, id := range []*string{&r.ManifestID, &r.Context.WorkspaceID, &r.Context.UserID, &r.Context.RequestID, &r.Context.SessionID, &r.Context.CorrelationID} {
		*id = format(*id)
	}
	return r
}

func TestPrivateEndpointCanonicalizesUUIDs(t *testing.T) {
	want := request()
	for _, tc := range []struct {
		name   string
		format func(string) string
	}{
		{"uppercase", strings.ToUpper},
		{"compact", func(id string) string { return strings.ReplaceAll(id, "-", "") }},
		{"braced", func(id string) string { return "{" + id + "}" }},
		{"urn", func(id string) string { return "urn:uuid:" + id }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(alternateUUIDs(want, tc.format))
			if err != nil {
				t.Fatal(err)
			}
			g := &fakeGenerator{}
			r := httptest.NewRequest("POST", "/v1/iac/generate", strings.NewReader(string(body)))
			r.Header.Set("Authorization", "Bearer test-token")
			w := httptest.NewRecorder()
			NewHandler(g, "test-token").ServeHTTP(w, r)
			if w.Code != 200 {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			got, _ := json.Marshal(g.input)
			expected, _ := json.Marshal(want)
			if string(got) != string(expected) {
				t.Fatalf("generator received noncanonical request: %s", got)
			}
		})
	}
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
	if validRequest(&valid) {
		t.Fatal("write permission not enforced")
	}
	valid = request()
	valid.Context.IdempotencyKey = " "
	if validRequest(&valid) {
		t.Fatal("empty key accepted")
	}
}

func TestPrivateEndpointRejectsInvalidUUIDs(t *testing.T) {
	for _, field := range []string{"manifest", "workspace", "user", "run", "session", "correlation"} {
		for _, value := range []string{"invalid", uuid.Nil.String()} {
			t.Run(field+"/"+value, func(t *testing.T) {
				input := request()
				ids := map[string]*string{"manifest": &input.ManifestID, "workspace": &input.Context.WorkspaceID,
					"user": &input.Context.UserID, "run": &input.Context.RequestID,
					"session": &input.Context.SessionID, "correlation": &input.Context.CorrelationID}
				*ids[field] = value
				body, err := json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
				g := &fakeGenerator{}
				r := httptest.NewRequest("POST", "/v1/iac/generate", strings.NewReader(string(body)))
				r.Header.Set("Authorization", "Bearer test-token")
				w := httptest.NewRecorder()
				NewHandler(g, "test-token").ServeHTTP(w, r)
				if w.Code != 400 || g.called {
					t.Fatalf("invalid UUID reached generator: status %d", w.Code)
				}
			})
		}
	}
}
