package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/provisr/backend/internal/manifest"
	"github.com/provisr/backend/pkg/middleware"
)

func TestManifestServiceHealthRoutes(t *testing.T) {
	logger := middleware.New("manifest-service-test")
	handler := manifest.NewWithStore(logger, manifest.NewMemoryStore())

	for _, path := range []string{"/health/live", "/health/ready"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", path, w.Code)
		}
	}
}

func TestManifestServiceValidateRoute(t *testing.T) {
	logger := middleware.New("manifest-service-test")
	handler := manifest.NewWithStore(logger, manifest.NewMemoryStore())

	body := `{"schema_version":"1.0.0","provider":"aws","region":"us-east-1",` +
		`"environment":"production","resources":[{"logical_name":"r1","type":"storage.aws.s3_bucket"}]}`

	req := httptest.NewRequest(http.MethodPost, "/v1/manifests/validate", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"valid":true`) {
		t.Fatalf("expected valid manifest, got %s", w.Body.String())
	}
}
