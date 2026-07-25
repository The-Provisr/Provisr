package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/provisr/platform/services/approval/internal/orchestration"
)

type OrchestrationClient interface {
	Transition(context.Context, string, orchestration.TransitionRequest) (json.RawMessage, error)
}

type ApprovalHandler struct {
	orchestration OrchestrationClient
}

func New(orchestration OrchestrationClient) *ApprovalHandler {
	return &ApprovalHandler{orchestration: orchestration}
}

func (h *ApprovalHandler) Decide(w http.ResponseWriter, r *http.Request) {
	requestID := chi.URLParam(r, "request_id")
	if requestID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "request_id is required")
		return
	}

	var body struct {
		Approved        *bool  `json:"approved"`
		ExpectedVersion int    `json:"expected_version"`
		Actor           string `json:"actor"`
		Reason          string `json:"reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if body.Approved == nil || body.ExpectedVersion < 1 || body.Actor == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "approved, expected_version, and actor are required")
		return
	}

	transition := orchestration.TransitionRequest{
		NewStatus:       "PROVISIONING",
		ExpectedVersion: body.ExpectedVersion,
		Actor:           body.Actor,
	}
	if !*body.Approved {
		code := "APPROVAL_REJECTED"
		message := body.Reason
		if message == "" {
			message = "Request was rejected by an approver."
		}
		transition.NewStatus = "ABANDONED"
		transition.ErrorCode = &code
		transition.ErrorMessage = &message
	}

	result, err := h.orchestration.Transition(r.Context(), requestID, transition)
	if err != nil {
		var responseErr *orchestration.ResponseError
		if errors.As(err, &responseErr) {
			writeError(w, responseErr.StatusCode, "ORCHESTRATION_REJECTED", responseErr.Body)
			return
		}
		writeError(w, http.StatusBadGateway, "ORCHESTRATION_ERROR", "approval decision could not be applied")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":   code,
		"message": message,
	})
}
