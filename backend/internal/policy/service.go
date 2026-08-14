package policy

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

const maxBody = 1 << 20

// error strings
var (
	errIdempotencyKeyMissing = errors.New("idempotency key missing")
	errIdempotencyKeyUsed    = errors.New("idempotency key already used")
)

type contextKey string
const correlationIDKey contextKey = "correlation_id"

// --- Models ---

type policyPack struct {
	ID           string  `json:"id"`
	WorkspaceID  *string `json:"workspace_id"`
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	Category     string  `json:"category"`
	IsSystemPack bool    `json:"is_system_pack"`
	IsEnabled    bool    `json:"is_enabled"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

type policySettings struct {
	WorkspaceID    string   `json:"workspace_id"`
	EnabledPackIDs []string `json:"enabled_pack_ids"`
	Mode           string   `json:"mode"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
}

type updateSettingsRequest struct {
	EnabledPackIDs *[]string `json:"enabled_pack_ids"`
	Mode           *string   `json:"mode"`
}

type createPackRequest struct {
	WorkspaceID string `json:"workspace_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

// --- Server ---

type server struct {
	db  *sql.DB
	log zerolog.Logger
}

func New(db *sql.DB, log zerolog.Logger) http.Handler {
	s := &server{db: db, log: log}

	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())

	mux.HandleFunc("GET /v1/policy-packs", s.handleListPacks)
	mux.HandleFunc("GET /v1/policy-packs/{pack_id}", s.handleGetPack)
	mux.HandleFunc("POST /v1/policy-packs", s.handleCreatePack)
	mux.HandleFunc("GET /v1/workspaces/{workspace_id}/policy-settings", s.handleGetSettings)
	mux.HandleFunc("PUT /v1/workspaces/{workspace_id}/policy-settings", s.handleUpdateSettings)

	return loggingMiddleware(log, s.recoveryMiddleware(mux))
}

// --- Handlers ---

func (s *server) handleListPacks(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id query parameter is required")
		return
	}
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	rows, err := s.db.Query(
		`SELECT id, workspace_id, name, description, category, is_system_pack, is_enabled, created_at, updated_at
		 FROM provisr_policy.policy_packs
		 WHERE workspace_id IS NULL OR workspace_id = $1
		 ORDER BY is_system_pack DESC, name`,
		workspaceID,
	)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to list policy packs")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to list policy packs")
		return
	}
	defer rows.Close()

	packs := []policyPack{}
	for rows.Next() {
		var p policyPack
		var wsID sql.NullString
		if err := rows.Scan(&p.ID, &wsID, &p.Name, &p.Description, &p.Category, &p.IsSystemPack, &p.IsEnabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to scan policy pack")
			s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to list policy packs")
			return
		}
		if wsID.Valid {
			p.WorkspaceID = &wsID.String
		}
		packs = append(packs, p)
	}
	if err := rows.Err(); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to iterate policy packs")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to list policy packs")
		return
	}

	s.writeJSON(w, http.StatusOK, packs)
}

func (s *server) handleGetPack(w http.ResponseWriter, r *http.Request) {
	packID := r.PathValue("pack_id")
	if _, err := uuid.Parse(packID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "pack_id must be a valid UUID")
		return
	}

	var p policyPack
	var wsID sql.NullString
	err := s.db.QueryRow(
		`SELECT id, workspace_id, name, description, category, is_system_pack, is_enabled, created_at, updated_at
		 FROM provisr_policy.policy_packs
		 WHERE id = $1`,
		packID,
	).Scan(&p.ID, &wsID, &p.Name, &p.Description, &p.Category, &p.IsSystemPack, &p.IsEnabled, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		s.writeError(r, w, http.StatusNotFound, "pack_not_found", "policy pack not found")
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to get policy pack")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to get policy pack")
		return
	}
	if wsID.Valid {
		p.WorkspaceID = &wsID.String
	}

	s.writeJSON(w, http.StatusOK, p)
}

func (s *server) handleCreatePack(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req createPackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	if req.WorkspaceID == "" || req.Name == "" || req.Category == "" {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id, name, and category are required")
		return
	}
	if _, err := uuid.Parse(req.WorkspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to begin tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.claimIdempotencyKey(r.Context(), tx, r, req.WorkspaceID, "create_policy_pack"); err != nil {
		s.writeIdempotencyError(w, r, err)
		return
	}

	var p policyPack
	var wsID sql.NullString
	err = tx.QueryRow(
		`INSERT INTO provisr_policy.policy_packs (workspace_id, name, description, category, is_system_pack, is_enabled)
		 SELECT id, $2, $3, $4::provisr_policy.pack_category, false, true
		 FROM provisr_identity.workspaces WHERE id = $1
		 RETURNING id, workspace_id, name, description, category, is_system_pack, is_enabled, created_at, updated_at`,
		req.WorkspaceID, req.Name, req.Description, req.Category,
	).Scan(&p.ID, &wsID, &p.Name, &p.Description, &p.Category, &p.IsSystemPack, &p.IsEnabled, &p.CreatedAt, &p.UpdatedAt)
	
	if err == sql.ErrNoRows {
		s.writeError(r, w, http.StatusBadRequest, "workspace_not_found", "workspace does not exist")
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to create policy pack")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}
	if wsID.Valid {
		p.WorkspaceID = &wsID.String
	}

	auditPayload := map[string]any{
		"pack_id": p.ID,
		"name": p.Name,
		"category": p.Category,
	}
	if err := s.emitAudit(r.Context(), tx, req.WorkspaceID, "state_transition", p.ID, auditPayload); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to emit audit event")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}

	if err := tx.Commit(); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to commit tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}

	s.writeJSON(w, http.StatusCreated, p)
}

func (s *server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	var settings policySettings
	var packIDs pq.StringArray
	err := s.db.QueryRow(
		`SELECT workspace_id, enabled_pack_ids, mode, created_at, updated_at
		 FROM provisr_policy.workspace_policy_settings
		 WHERE workspace_id = $1`,
		workspaceID,
	).Scan(&settings.WorkspaceID, &packIDs, &settings.Mode, &settings.CreatedAt, &settings.UpdatedAt)
	if err == sql.ErrNoRows {
		err = s.db.QueryRow(
			`INSERT INTO provisr_policy.workspace_policy_settings (workspace_id, enabled_pack_ids, mode)
			 SELECT id, ARRAY['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003']::uuid[], 'enforced'::provisr_policy.policy_mode
			 FROM provisr_identity.workspaces
			 WHERE id = $1
			 RETURNING workspace_id, enabled_pack_ids, mode, created_at, updated_at`,
			workspaceID,
		).Scan(&settings.WorkspaceID, &packIDs, &settings.Mode, &settings.CreatedAt, &settings.UpdatedAt)
		if err == sql.ErrNoRows {
			s.writeError(r, w, http.StatusNotFound, "workspace_not_found", "workspace does not exist")
			return
		}
		if err != nil {
			zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to initialize policy settings")
			s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to initialize policy settings")
			return
		}
		settings.EnabledPackIDs = []string(packIDs)
		s.writeJSON(w, http.StatusOK, settings)
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to get policy settings")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to get policy settings")
		return
	}
	settings.EnabledPackIDs = []string(packIDs)
	if settings.EnabledPackIDs == nil {
		settings.EnabledPackIDs = []string{}
	}

	s.writeJSON(w, http.StatusOK, settings)
}

func (s *server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req updateSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if req.Mode != nil {
		if *req.Mode != "enforced" && *req.Mode != "audit_only" {
			s.writeError(r, w, http.StatusBadRequest, "validation_error", "mode must be enforced or audit_only")
			return
		}
	}

	if req.EnabledPackIDs != nil {
		for _, id := range *req.EnabledPackIDs {
			if _, err := uuid.Parse(id); err != nil {
				s.writeError(r, w, http.StatusBadRequest, "validation_error", fmt.Sprintf("invalid pack id: %s", id))
				return
			}
		}

		for _, packID := range *req.EnabledPackIDs {
			var exists bool
			err := s.db.QueryRow(
				`SELECT EXISTS(SELECT 1 FROM provisr_policy.policy_packs WHERE id = $1 AND (workspace_id IS NULL OR workspace_id = $2))`,
				packID, workspaceID,
			).Scan(&exists)
			if err != nil {
				zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to verify pack")
				s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
				return
			}
			if !exists {
				s.writeError(r, w, http.StatusBadRequest, "pack_not_found", fmt.Sprintf("policy pack %s not found", packID))
				return
			}
		}
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to begin tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.claimIdempotencyKey(r.Context(), tx, r, workspaceID, "update_policy_settings"); err != nil {
		s.writeIdempotencyError(w, r, err)
		return
	}

	var existingPackIDs pq.StringArray
	var existingMode string
	err = tx.QueryRow(
		`SELECT enabled_pack_ids, mode
		 FROM provisr_policy.workspace_policy_settings
		 WHERE workspace_id = $1 FOR UPDATE`,
		workspaceID,
	).Scan(&existingPackIDs, &existingMode)

	finalMode := "enforced"
	finalPacks := []string{"a0000000-0000-0000-0000-000000000001", "a0000000-0000-0000-0000-000000000002", "a0000000-0000-0000-0000-000000000003"}
	if err == nil {
		finalMode = existingMode
		finalPacks = []string(existingPackIDs)
	} else if err != sql.ErrNoRows {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to read existing settings")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}

	if req.Mode != nil {
		finalMode = *req.Mode
	}
	if req.EnabledPackIDs != nil {
		finalPacks = *req.EnabledPackIDs
	}

	var settings policySettings
	var packIDs pq.StringArray
	err = tx.QueryRow(
		`INSERT INTO provisr_policy.workspace_policy_settings (workspace_id, enabled_pack_ids, mode)
		 SELECT id, $2, $3::provisr_policy.policy_mode
		 FROM provisr_identity.workspaces WHERE id = $1
		 ON CONFLICT (workspace_id) DO UPDATE SET
		   enabled_pack_ids = EXCLUDED.enabled_pack_ids,
		   mode = EXCLUDED.mode,
		   updated_at = now()
		 RETURNING workspace_id, enabled_pack_ids, mode, created_at, updated_at`,
		workspaceID, pq.Array(finalPacks), finalMode,
	).Scan(&settings.WorkspaceID, &packIDs, &settings.Mode, &settings.CreatedAt, &settings.UpdatedAt)
	if err == sql.ErrNoRows {
		s.writeError(r, w, http.StatusBadRequest, "workspace_not_found", "workspace does not exist")
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to update policy settings")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}
	settings.EnabledPackIDs = []string(packIDs)
	if settings.EnabledPackIDs == nil {
		settings.EnabledPackIDs = []string{}
	}

	auditPayload := map[string]any{
		"enabled_pack_ids": settings.EnabledPackIDs,
		"mode":             settings.Mode,
	}
	if err := s.emitAudit(r.Context(), tx, workspaceID, "state_transition", workspaceID, auditPayload); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to emit audit event")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}

	if err := tx.Commit(); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to commit tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}

	s.writeJSON(w, http.StatusOK, settings)
}

// --- Helpers ---

func (s *server) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// Log the encoding error
		// At this point status is written, so we can't change it, just log.
		fmt.Printf("failed to encode json response: %v\n", err)
	}
}

func (s *server) writeError(r *http.Request, w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"error":   code,
		"message": message,
		"status":  status,
	}); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to encode json error response")
	}
}

func (s *server) claimIdempotencyKey(ctx context.Context, tx *sql.Tx, r *http.Request, workspaceID, mutation string) error {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 128 {
		return errIdempotencyKeyMissing
	}
	res, err := tx.Exec(
		`INSERT INTO provisr_idempotency.keys (workspace_id, key, mutation)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (workspace_id, key) DO NOTHING`,
		workspaceID, key, mutation,
	)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errIdempotencyKeyUsed
	}
	return nil
}

func (s *server) writeIdempotencyError(w http.ResponseWriter, r *http.Request, err error) {
	log := zerolog.Ctx(r.Context())
	switch {
	case errors.Is(err, errIdempotencyKeyMissing):
		s.writeError(r, w, http.StatusBadRequest, "idempotency_key_required", "Idempotency-Key header is required for mutations")
	case errors.Is(err, errIdempotencyKeyUsed):
		s.writeError(r, w, http.StatusConflict, "duplicate_idempotency_key", "Idempotency-Key was already used for a mutation")
	default:
		log.Error().Err(err).Msg("failed to claim idempotency key")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to process mutation")
	}
}

func (s *server) emitAudit(ctx context.Context, tx *sql.Tx, workspaceID, eventType, resourceID string, payload map[string]any) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal audit payload: %w", err)
	}

	var previousHash sql.NullString
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtext('provisr_audit.chain'), 0)`); err != nil {
		return fmt.Errorf("acquire audit chain lock: %w", err)
	}
	if err := tx.QueryRow(
		`SELECT hash FROM provisr_audit.audit_events ORDER BY seq DESC LIMIT 1`,
	).Scan(&previousHash); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read previous audit hash: %w", err)
	}

	correlationID := correlationID(ctx)
	sum := sha256.New()
	sum.Write([]byte(previousHash.String))
	sum.Write([]byte(eventType))
	sum.Write(payloadJSON)
	sum.Write([]byte(correlationID))
	eventHash := hex.EncodeToString(sum.Sum(nil))

	var prev any
	if previousHash.Valid {
		prev = previousHash.String
	}
	_, err = tx.Exec(
		`INSERT INTO provisr_audit.audit_events
		   (workspace_id, event_type, actor_id, actor_type, resource_type, resource_id,
		    payload, hash, previous_hash, correlation_id)
		 VALUES ($1, $2::provisr_audit.event_type, $3, 'system', 'policy', $4, $5, $6, $7, $8)`,
		workspaceID, eventType, "policy-service", resourceID, payloadJSON, eventHash, prev, correlationID,
	)
	if err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return nil
}

func correlationID(ctx context.Context) string {
	if v, ok := ctx.Value(correlationIDKey).(string); ok && v != "" {
		return v
	}
	return uuid.NewString()
}

func (s *server) recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				zerolog.Ctx(r.Context()).Error().Interface("panic", rec).Str("path", r.URL.Path).Msg("panic recovered")
				s.writeError(r, w, http.StatusInternalServerError, "internal_error", "unexpected server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(base zerolog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.NewString()
		}
		corrID := r.Header.Get("X-Correlation-ID")
		if _, err := uuid.Parse(corrID); err != nil {
			corrID = requestID
		}

		l := base.With().Str("request_id", requestID).Str("correlation_id", corrID).Logger()
		ctx := l.WithContext(r.Context())
		ctx = context.WithValue(ctx, correlationIDKey, corrID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
