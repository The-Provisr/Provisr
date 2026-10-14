package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/provisr/backend/internal/policy"
	"github.com/provisr/backend/pkg/middleware"
)

func TestPolicyServiceHealthRoute(t *testing.T) {
	logger := middleware.New("policy-service-test")
	handler := policy.New(nil, logger)

	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	reqReady := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	wReady := httptest.NewRecorder()
	handler.ServeHTTP(wReady, reqReady)
	if wReady.Code != http.StatusOK {
		t.Fatalf("expected ready status 200, got %d", wReady.Code)
	}
}

func TestPolicyServiceRouteRequiresWorkspace(t *testing.T) {
	logger := middleware.New("policy-service-test")
	handler := policy.New(nil, logger)

	req := httptest.NewRequest(http.MethodGet, "/v1/policy-packs", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	// Since workspace_id is missing, it should return 400 Bad Request
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for missing workspace_id, got %d", w.Code)
	}
}
