package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/provisr/platform/services/approval/internal/orchestration"
)

type fakeOrchestration struct {
	input orchestration.TransitionRequest
}

func (f *fakeOrchestration) Transition(_ context.Context, _ string, input orchestration.TransitionRequest) (json.RawMessage, error) {
	f.input = input
	return json.RawMessage(`{"status":"ok"}`), nil
}

func TestDecideMapsApprovalDecisionToTransition(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus string
	}{
		{name: "approved", body: `{"approved":true,"expected_version":4,"actor":"approver-1"}`, wantStatus: "PROVISIONING"},
		{name: "rejected", body: `{"approved":false,"expected_version":4,"actor":"approver-1","reason":"too risky"}`, wantStatus: "ABANDONED"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeOrchestration{}
			h := New(client)
			router := chi.NewRouter()
			router.Post("/v1/approvals/{request_id}/decision", h.Decide)

			req := httptest.NewRequest(http.MethodPost, "/v1/approvals/request-1/decision", bytes.NewBufferString(tt.body))
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)

			if res.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
			}
			if client.input.NewStatus != tt.wantStatus {
				t.Fatalf("new status = %s, want %s", client.input.NewStatus, tt.wantStatus)
			}
		})
	}
}
