package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provisr/platform/services/audit/internal/model"
	"github.com/rs/zerolog/log"
)

// EventHandler holds dependencies for audit event HTTP handlers.
type EventHandler struct {
	DB *pgxpool.Pool
}

// NewEventHandler creates a handler with the given database pool.
func NewEventHandler(db *pgxpool.Pool) *EventHandler {
	return &EventHandler{DB: db}
}
func (h *EventHandler) CreateEvent(w http.ResponseWriter, r *http.Request) {
	// 1. Decode request body
	var req model.CreateEventRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, model.ErrorResponse{
			Errors: []model.ValidationError{
				{Field: "body", Message: "invalid JSON: " + err.Error()},
			},
		})
		return
	}

	// 2. Validate required fields
	errs := validateCreateEvent(req)
	if len(errs) > 0 {
		writeJSON(w, http.StatusBadRequest, model.ErrorResponse{Errors: errs})
		return
	}

	// 3. Look up previous event hash for this org
	prevHash, err := h.getLastEventHash(r.Context(), req.OrgID)
	if err != nil {
		log.Error().Err(err).Str("org_id", req.OrgID).Msg("Failed to get last event hash")
		writeJSON(w, http.StatusInternalServerError, model.ErrorResponse{
			Errors: []model.ValidationError{
				{Field: "internal", Message: "failed to compute hash chain"},
			},
		})
		return
	}

	// 4. Compute event hash
	now := time.Now().UTC()
	canonical := buildCanonicalString(req, prevHash, now)
	hash := sha256Hex(canonical)

	// 5. Insert into database
	var eventID string
	err = h.DB.QueryRow(r.Context(),
		`INSERT INTO provisr_audit.audit_events (
			org_id, event_type, event_severity,
			actor_type, actor_id, actor_role_snapshot,
			actor_ip, actor_user_agent,
			request_id, resource_id,
			subject_type, subject_id,
			action, outcome, reason,
			from_state, to_state,
			tool_name, policy_violations,
			manifest_hash,
			trace_id, span_id, correlation_id,
			source_service, source_version,
			metadata,
			prev_event_hash, event_hash
		) VALUES (
			$1, $2, $3,
			$4, $5, $6,
			$7, $8,
			$9, $10,
			$11, $12,
			$13, $14, $15,
			$16, $17,
			$18, $19,
			$20,
			$21, $22, $23,
			$24, $25,
			$26,
			$27, $28
		) RETURNING event_id`,
		req.OrgID, req.EventType, req.EventSeverity,
		req.ActorType, nullableUUID(req.ActorID), req.ActorRoleSnapshot,
		nullableStr(req.ActorIP), nullableStr(req.ActorUserAgent),
		nullableUUID(req.RequestID), nullableUUID(req.ResourceID),
		nullableStr(req.SubjectType), nullableUUID(req.SubjectID),
		req.Action, req.Outcome, nullableStr(req.Reason),
		nullableStr(req.FromState), nullableStr(req.ToState),
		nullableStr(req.ToolName), toJSONB(req.PolicyViolations),
		nullableStr(req.ManifestHash),
		nullableStr(req.TraceID), nullableStr(req.SpanID), nullableStr(req.CorrelationID),
		req.SourceService, nullableStr(req.SourceVersion),
		toJSONB(req.Metadata),
		nullableStr(prevHash), hash,
	).Scan(&eventID)
	if err != nil {
		log.Error().Err(err).Msg("Failed to insert audit event")
		writeJSON(w, http.StatusInternalServerError, model.ErrorResponse{
			Errors: []model.ValidationError{
				{Field: "internal", Message: "failed to persist audit event"},
			},
		})
		return
	}

	// 6. Return the generated ID and hash
	resp := model.CreateEventResponse{
		EventID:   eventID,
		EventHash: hash,
		CreatedAt: now.Format(time.RFC3339),
	}
	writeJSON(w, http.StatusCreated, resp)
}

// validateCreateEvent checks that all required fields are present.
// Returns a slice of validation errors (empty = valid).
func validateCreateEvent(req model.CreateEventRequest) []model.ValidationError {
	var errs []model.ValidationError

	if req.OrgID == "" {
		errs = append(errs, model.ValidationError{Field: "org_id", Message: "is required"})
	}
	if req.EventType == "" {
		errs = append(errs, model.ValidationError{Field: "event_type", Message: "is required"})
	}
	if req.ActorType == "" {
		errs = append(errs, model.ValidationError{Field: "actor_type", Message: "is required"})
	}
	if req.Action == "" {
		errs = append(errs, model.ValidationError{Field: "action", Message: "is required"})
	}
	if req.Outcome == "" {
		errs = append(errs, model.ValidationError{Field: "outcome", Message: "is required"})
	}
	if req.SourceService == "" {
		errs = append(errs, model.ValidationError{Field: "source_service", Message: "is required"})
	}

	// outcome must be one of the allowed values
	if req.Outcome != "" && req.Outcome != "success" && req.Outcome != "failure" && req.Outcome != "denied" {
		errs = append(errs, model.ValidationError{Field: "outcome", Message: "must be 'success', 'failure', or 'denied'"})
	}

	// reason required when outcome is not success
	if req.Outcome != "" && req.Outcome != "success" && req.Reason == "" {
		errs = append(errs, model.ValidationError{Field: "reason", Message: "is required when outcome is not 'success'"})
	}

	return errs
}

// getLastEventHash retrieves the most recent event_hash for the given org.
// Returns empty string if no prior events exist (first event in chain).
func (h *EventHandler) getLastEventHash(ctx context.Context, orgID string) (string, error) {
	var hash *string
	err := h.DB.QueryRow(ctx,
		`SELECT event_hash FROM provisr_audit.audit_events
		 WHERE org_id = $1
		 ORDER BY created_at DESC
		 LIMIT 1`,
		orgID,
	).Scan(&hash)

	if err != nil {
		// pgx returns ErrNoRows when no rows match — this is expected.
		// For the first event, there's no previous hash.
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}

	if hash == nil {
		return "", nil
	}
	return *hash, nil
}

// buildCanonicalString creates a deterministic string for SHA-256 hashing.
// The format is: field1|field2|...|prev_hash|timestamp
// This ensures the hash covers all relevant fields.
func buildCanonicalString(req model.CreateEventRequest, prevHash string, now time.Time) string {
	return fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s",
		req.OrgID,
		req.EventType,
		req.EventSeverity,
		req.ActorType,
		req.Action,
		req.Outcome,
		req.Reason,
		req.FromState,
		req.ToState,
		req.ToolName,
		req.SourceService,
		req.ManifestHash,
		prevHash,
		now.Format(time.RFC3339Nano),
	)
}

// sha256Hex computes SHA-256 of the input string and returns hex-encoded.
func sha256Hex(input string) string {
	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:])
}

// writeJSON serializes the response as JSON and writes it to the http.ResponseWriter.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// nullableUUID returns a *string from a string, or nil if empty.
// pgx handles *string as SQL NULL when nil.
func nullableUUID(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// nullableStr is an alias for nullableUUID for non-UUID optional fields.
func nullableStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// toJSONB marshals v into a json.RawMessage for pgx JSONB support.
// Returns nil if v is nil.
func toJSONB(v any) []byte {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}
