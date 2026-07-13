package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/provisr/platform/services/orchestration/internal/events"
	"github.com/provisr/platform/services/orchestration/internal/models"
	policyclient "github.com/provisr/platform/services/orchestration/internal/policy"
	"github.com/provisr/platform/services/orchestration/internal/repository"
	"github.com/provisr/platform/services/orchestration/internal/statemachine"
)

type ProvisionHandler struct {
	repo    *repository.Repository
	machine *statemachine.Machine
	events  events.Publisher
	policy  PolicyClient
}

type PolicyClient interface {
	Evaluate(context.Context, policyclient.EvaluateRequest) (policyclient.EvaluateResponse, error)
}

func New(repo *repository.Repository, machine *statemachine.Machine, events events.Publisher, policy PolicyClient) *ProvisionHandler {
	return &ProvisionHandler{repo: repo, machine: machine, events: events, policy: policy}
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: code, Message: message})
}

func uuidFromParam(r *http.Request, name string) (uuid.UUID, error) {
	raw := chi.URLParam(r, name)
	if raw == "" {
		return uuid.Nil, errors.New("missing URL parameter")
	}
	return uuid.Parse(raw)
}

func (h *ProvisionHandler) CreateProvision(w http.ResponseWriter, r *http.Request) {
	var req models.CreateProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	if req.OrgID == uuid.Nil || req.SubmitterUserID == uuid.Nil || req.Intent == "" || req.NLInput == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "org_id, submitter_user_id, intent, and nl_input are required")
		return
	}

	if req.IdempotencyKey != nil && *req.IdempotencyKey != "" {
		existing, err := h.repo.FindByIdempotencyKey(r.Context(), req.OrgID, *req.IdempotencyKey)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to check idempotency")
			return
		}
		if existing != nil {
			writeJSON(w, http.StatusOK, existing)
			return
		}
	}

	correlationID := r.Header.Get("X-Correlation-ID")

	provisionReq := &models.ProvisioningRequest{
		OrgID:           req.OrgID,
		SubmitterUserID: req.SubmitterUserID,
		Intent:          req.Intent,
		Status:          models.StatusReceived,
		NLInput:         req.NLInput,
		IdempotencyKey:  req.IdempotencyKey,
		CorrelationID:   &correlationID,
	}

	if err := h.repo.CreateRequest(r.Context(), provisionReq); err != nil {
		log.Error().Err(err).Msg("failed to create provisioning request")
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to create provisioning request")
		return
	}

	updated, err := h.machine.Transition(r.Context(), statemachine.TransitionInput{
		RequestID:       provisionReq.RequestID,
		NewStatus:       models.StatusPendingAgent,
		ExpectedVersion: provisionReq.StateVersion,
	})
	if err != nil {
		log.Warn().Err(err).Str("request_id", provisionReq.RequestID.String()).Msg("auto-transition to PENDING_AGENT failed, request created but not transitioned")
		writeJSON(w, http.StatusCreated, provisionReq)
		return
	}

	go func() {
		event := models.StateChangedEvent{
			EventID:        uuid.New(),
			RequestID:      updated.RequestID,
			OrgID:          updated.OrgID,
			PreviousStatus: models.StatusReceived,
			NewStatus:      updated.Status,
			StateVersion:   updated.StateVersion,
			Actor:          "system",
			Timestamp:      time.Now().UTC(),
			CorrelationID:  correlationID,
		}
		if pubErr := h.events.PublishStateChanged(context.Background(), event); pubErr != nil {
			log.Error().Err(pubErr).Str("request_id", updated.RequestID.String()).Msg("failed to publish state changed event")
		}
	}()

	writeJSON(w, http.StatusCreated, updated)
}

func (h *ProvisionHandler) GetRequest(w http.ResponseWriter, r *http.Request) {
	requestID, err := uuidFromParam(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "request_id must be a valid UUID")
		return
	}

	req, err := h.repo.GetRequest(r.Context(), requestID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "request not found")
			return
		}
		log.Error().Err(err).Str("request_id", requestID.String()).Msg("failed to get request")
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch request")
		return
	}

	writeJSON(w, http.StatusOK, req)
}

func (h *ProvisionHandler) TransitionRequest(w http.ResponseWriter, r *http.Request) {
	requestID, err := uuidFromParam(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "request_id must be a valid UUID")
		return
	}

	var body struct {
		NewStatus       models.RequestStatus `json:"new_status"`
		ExpectedVersion int                  `json:"expected_version"`
		ErrorCode       *string              `json:"error_code,omitempty"`
		ErrorMessage    *string              `json:"error_message,omitempty"`
		Actor           string               `json:"actor,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	if body.NewStatus == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "new_status is required")
		return
	}

	if body.Actor == "" {
		body.Actor = "system"
	}

	currentReq, err := h.repo.GetRequest(r.Context(), requestID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "request not found")
			return
		}
		log.Error().Err(err).Str("request_id", requestID.String()).Msg("failed to fetch current request for transition")
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch request")
		return
	}
	previousStatus := currentReq.Status

	updated, err := h.machine.Transition(r.Context(), statemachine.TransitionInput{
		RequestID:       requestID,
		NewStatus:       body.NewStatus,
		ExpectedVersion: body.ExpectedVersion,
		ErrorCode:       body.ErrorCode,
		ErrorMessage:    body.ErrorMessage,
	})
	if err != nil {
		switch {
		case errors.Is(err, statemachine.ErrIllegalTransition):
			writeError(w, http.StatusConflict, "ILLEGAL_TRANSITION", err.Error())
		case errors.Is(err, repository.ErrVersionConflict):
			writeError(w, http.StatusConflict, "VERSION_CONFLICT", "request was modified by another process")
		case errors.Is(err, repository.ErrNotFound):
			writeError(w, http.StatusNotFound, "NOT_FOUND", "request not found")
		default:
			log.Error().Err(err).Str("request_id", requestID.String()).Msg("transition failed")
			writeError(w, http.StatusInternalServerError, "TRANSITION_FAILED", err.Error())
		}
		return
	}

	go func() {
		event := models.StateChangedEvent{
			EventID:        uuid.New(),
			RequestID:      updated.RequestID,
			OrgID:          updated.OrgID,
			PreviousStatus: previousStatus,
			NewStatus:      updated.Status,
			StateVersion:   updated.StateVersion,
			Actor:          body.Actor,
			Timestamp:      time.Now().UTC(),
			CorrelationID: func() string {
				if updated.CorrelationID != nil {
					return *updated.CorrelationID
				}
				return ""
			}(),
		}
		if pubErr := h.events.PublishStateChanged(context.Background(), event); pubErr != nil {
			log.Error().Err(pubErr).Str("request_id", updated.RequestID.String()).Msg("failed to publish state changed event")
		}
	}()

	writeJSON(w, http.StatusOK, updated)
}

func (h *ProvisionHandler) CheckPolicy(w http.ResponseWriter, r *http.Request) {
	requestID, err := uuidFromParam(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "request_id must be a valid UUID")
		return
	}

	var body struct {
		Manifest policyclient.Manifest `json:"manifest"`
		Actor    string                `json:"actor,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if body.Manifest.Provider == "" || body.Manifest.Region == "" || body.Manifest.EstimatedMonthlyCostUSD < 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "manifest.provider and manifest.region are required, and estimated cost cannot be negative")
		return
	}
	if body.Manifest.Tags == nil {
		body.Manifest.Tags = map[string]string{}
	}
	if body.Actor == "" {
		body.Actor = "system"
	}

	current, err := h.repo.GetRequest(r.Context(), requestID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "request not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch request")
		return
	}
	if current.Status != models.StatusPolicyCheck {
		writeError(w, http.StatusConflict, "INVALID_STATE", "request must be in POLICY_CHECK before evaluation")
		return
	}

	decision, err := h.policy.Evaluate(r.Context(), policyclient.EvaluateRequest{
		OrgID:    current.OrgID,
		Manifest: body.Manifest,
	})
	if err != nil {
		log.Error().Err(err).Str("request_id", requestID.String()).Msg("policy evaluation request failed")
		writeError(w, http.StatusBadGateway, "POLICY_SERVICE_ERROR", "policy evaluation could not be completed")
		return
	}

	nextStatus := models.StatusPendingApproval
	if !decision.Passed {
		nextStatus = models.StatusPendingAgent
	}

	updated, err := h.machine.Transition(r.Context(), statemachine.TransitionInput{
		RequestID:       requestID,
		NewStatus:       nextStatus,
		ExpectedVersion: current.StateVersion,
	})
	if err != nil {
		if errors.Is(err, repository.ErrVersionConflict) {
			writeError(w, http.StatusConflict, "VERSION_CONFLICT", "request was modified during policy evaluation")
			return
		}
		writeError(w, http.StatusInternalServerError, "TRANSITION_FAILED", "failed to apply policy decision")
		return
	}

	go h.publishTransition(updated, models.StatusPolicyCheck, body.Actor)

	writeJSON(w, http.StatusOK, struct {
		Passed     bool                        `json:"passed"`
		Violations []policyclient.Violation    `json:"violations"`
		Request    *models.ProvisioningRequest `json:"request"`
	}{
		Passed:     decision.Passed,
		Violations: decision.Violations,
		Request:    updated,
	})
}

func (h *ProvisionHandler) publishTransition(updated *models.ProvisioningRequest, previous models.RequestStatus, actor string) {
	event := models.StateChangedEvent{
		EventID:        uuid.New(),
		RequestID:      updated.RequestID,
		OrgID:          updated.OrgID,
		PreviousStatus: previous,
		NewStatus:      updated.Status,
		StateVersion:   updated.StateVersion,
		Actor:          actor,
		Timestamp:      time.Now().UTC(),
	}
	if updated.CorrelationID != nil {
		event.CorrelationID = *updated.CorrelationID
	}
	if err := h.events.PublishStateChanged(context.Background(), event); err != nil {
		log.Error().Err(err).Str("request_id", updated.RequestID.String()).Msg("failed to publish state changed event")
	}
}
