package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/provisr/backend/internal/approval"
	"github.com/provisr/backend/pkg/middleware"
)

func TestApprovalServiceHealthRoutes(t *testing.T) {
	handler := approval.New(nil, middleware.New("approval-service-test"), "token")

	for _, path := range []string{"/health/live", "/health/ready"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: expected status 200, got %d", path, w.Code)
		}
	}
}
