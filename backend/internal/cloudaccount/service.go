// Package cloudaccount implements the cloud-account-service HTTP API:
// encrypted storage and lookup of per-workspace cloud provider accounts.
package cloudaccount

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/provisr/backend/pkg/cloudcrypto"
	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

const maxBody = 1 << 20

type contextKey string

const (
	requestIDKey     contextKey = "request_id"
	correlationIDKey contextKey = "correlation_id"
)

type cloudAccount struct {
	ID                    string  `json:"id"`
	WorkspaceID           string  `json:"workspace_id"`
	Provider              string  `json:"provider"`
	Label                 string  `json:"label"`
	Status                string  `json:"status"`
	VerifiedAt            *string `json:"verified_at,omitempty"`
	CreatedAt             string  `json:"created_at"`
	UpdatedAt             string  `json:"updated_at"`
	MetadataEncrypted     bool    `json:"-"` // internal: used by create/list queries
	ExternalAccountIDHash string  `json:"-"` // never surfaced
}

// listCloudAccount is the surface-only projection returned by the list
// endpoint: no encrypted or hashed fields ever leave the service here.
type listCloudAccount struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Provider    string  `json:"provider"`
	Label       string  `json:"label"`
	Status      string  `json:"status"`
	VerifiedAt  *string `json:"verified_at,omitempty"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

type createRequest struct {
	WorkspaceID       string         `json:"workspace_id"`
	Provider          string         `json:"provider"`
	Label             string         `json:"label"`
	ExternalAccountID string         `json:"external_account_id,omitempty"`
	Metadata          map[string]any `json:"metadata"`
}

type statusRequest struct {
	Status string `json:"status"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}

var validProviders = map[string]bool{"aws": true, "azure": true, "gcp": true}
var validStatuses = map[string]bool{"pending": true, "active": true, "failed": true, "disconnected": true}

// New wires the routes and middleware for the cloud-account-service.
func New(db *sql.DB, log zerolog.Logger, master cloudcrypto.MasterKey) http.Handler {
	s := &server{db: db, log: log, master: master}

	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())

	mux.HandleFunc("POST /v1/cloud-accounts", s.handleCreate)
	mux.HandleFunc("GET /v1/cloud-accounts", s.handleList)
	mux.HandleFunc("GET /v1/cloud-accounts/{id}", s.handleGet)
	mux.HandleFunc("PATCH /v1/cloud-accounts/{id}/status", s.handleUpdateStatus)
	mux.HandleFunc("DELETE /v1/cloud-accounts/{id}", s.handleDelete)

	return s.recoveryMiddleware(loggingMiddleware(log, mux))
}

type server struct {
	db     *sql.DB
	log    zerolog.Logger
	master cloudcrypto.MasterKey
}

func (s *server) workspaceKey(ctx context.Context, workspaceID string) ([]byte, error) {
	key, err := cloudcrypto.DeriveWorkspaceKey(s.master, workspaceID)
	if err != nil {
		zerolog.Ctx(ctx).Error().Err(err).Str("workspace_id", workspaceID).Msg("failed to derive workspace key")
		return nil, err
	}
	return key, nil
}

// requireWorkspaceID validates the workspace_id query parameter every
// cloud-account operation is scoped to, preventing cross-workspace access.
func (s *server) requireWorkspaceID(w http.ResponseWriter, r *http.Request) (string, bool) {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "workspace_id query parameter is required")
		return "", false
	}
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return "", false
	}
	return workspaceID, true
}

func (s *server) handleCreate(w http.ResponseWriter, r *http.Request) {
	log := zerolog.Ctx(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if !validProviders[req.Provider] {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "provider must be aws, azure, or gcp")
		return
	}
	if strings.TrimSpace(req.Label) == "" || len(req.Label) > 255 {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "label must be between 1 and 255 characters")
		return
	}
	if _, err := uuid.Parse(req.WorkspaceID); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}
	if req.Metadata == nil {
		req.Metadata = map[string]any{}
	}
	if req.ExternalAccountID != "" && req.Provider != "aws" {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "external_account_id is only valid for aws accounts")
		return
	}

	workspaceKey, err := s.workspaceKey(r.Context(), req.WorkspaceID)
	if err != nil {
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to derive encryption key")
		return
	}

	encrypted, err := cloudcrypto.EncryptJSON(workspaceKey, req.Metadata)
	if err != nil {
		log.Error().Err(err).Msg("failed to encrypt metadata")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to encrypt account metadata")
		return
	}

	var externalIDHash *string
	if req.ExternalAccountID != "" {
		hash, err := cloudcrypto.HashExternalID(workspaceKey, req.ExternalAccountID)
		if err != nil {
			log.Error().Err(err).Msg("failed to hash external account id")
			s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to hash external account id")
			return
		}
		externalIDHash = &hash
	}

	// PRD §7: one slot per provider per workspace. Retry semantics: a pending
	// account may be re-submitted; its metadata is replaced. Any other state
	// rejects the duplicate provider.
	insertedID := ""
	err = s.db.QueryRow(
		`INSERT INTO provisr_cloud.cloud_accounts
		   (workspace_id, provider, label, external_account_id_hash, metadata_encrypted, status)
		 VALUES ($1, $2, $3, $4, $5, 'pending')
		 RETURNING id`,
		req.WorkspaceID, req.Provider, strings.TrimSpace(req.Label), externalIDHash, encrypted,
	).Scan(&insertedID)
	if err != nil {
		if isUniqueViolation(err) {
			if s.tryRetryPending(w, r, req, encrypted, externalIDHash) {
				return
			}
			s.writeError(r.Context(), w, http.StatusConflict, "provider_slot_taken",
				fmt.Sprintf("workspace already has a %s account; delete or reconnect it first", req.Provider))
			return
		}
		if isForeignKeyViolation(err) {
			s.writeError(r.Context(), w, http.StatusBadRequest, "workspace_not_found", "workspace does not exist")
			return
		}
		log.Error().Err(err).Msg("failed to insert cloud account")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to create cloud account")
		return
	}

	s.writeJSON(r.Context(), w, http.StatusCreated, map[string]string{
		"id": insertedID, "workspace_id": req.WorkspaceID, "provider": req.Provider,
		"label": strings.TrimSpace(req.Label), "status": "pending",
	})
}

// tryRetryPending updates metadata of an existing pending account for the same
// workspace/provider pair, returning true when the retry succeeded. The status
// read and the guarded update are one atomic statement: a concurrent status
// change between the two would otherwise make the retry report success after
// updating zero rows.
func (s *server) tryRetryPending(w http.ResponseWriter, r *http.Request, req createRequest, encrypted string, externalIDHash *string) bool {
	log := zerolog.Ctx(r.Context())
	var existingID string
	err := s.db.QueryRow(
		`UPDATE provisr_cloud.cloud_accounts
		 SET metadata_encrypted = $1, external_account_id_hash = $2, label = $3, updated_at = now()
		 WHERE workspace_id = $4 AND provider = $5 AND status = 'pending'
		 RETURNING id`,
		encrypted, externalIDHash, strings.TrimSpace(req.Label), req.WorkspaceID, req.Provider,
	).Scan(&existingID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false
		}
		log.Error().Err(err).Msg("failed to retry pending account")
		return false
	}

	s.writeJSON(r.Context(), w, http.StatusOK, map[string]string{
		"id": existingID, "workspace_id": req.WorkspaceID, "provider": req.Provider,
		"label": strings.TrimSpace(req.Label), "status": "pending",
	})
	return true
}

func (s *server) handleList(w http.ResponseWriter, r *http.Request) {
	log := zerolog.Ctx(r.Context())
	workspaceID, ok := s.requireWorkspaceID(w, r)
	if !ok {
		return
	}

	rows, err := s.db.Query(
		`SELECT id, workspace_id, provider, label, status, verified_at, created_at, updated_at
		 FROM provisr_cloud.cloud_accounts
		 WHERE workspace_id = $1
		 ORDER BY created_at DESC`,
		workspaceID,
	)
	if err != nil {
		log.Error().Err(err).Msg("failed to list cloud accounts")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to list cloud accounts")
		return
	}
	defer rows.Close()

	accounts := []listCloudAccount{}
	for rows.Next() {
		var a listCloudAccount
		var verifiedAt sql.NullString
		if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.Provider, &a.Label, &a.Status, &verifiedAt, &a.CreatedAt, &a.UpdatedAt); err != nil {
			log.Error().Err(err).Msg("failed to scan cloud account")
			s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to list cloud accounts")
			return
		}
		if verifiedAt.Valid {
			a.VerifiedAt = &verifiedAt.String
		}
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("failed to iterate cloud accounts")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to list cloud accounts")
		return
	}

	s.writeJSON(r.Context(), w, http.StatusOK, map[string]any{"accounts": accounts})
}

func (s *server) handleGet(w http.ResponseWriter, r *http.Request) {
	log := zerolog.Ctx(r.Context())
	workspaceID, ok := s.requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "id must be a valid UUID")
		return
	}

	var account cloudAccount
	var verifiedAt, metadataEncrypted sql.NullString
	err := s.db.QueryRow(
		`SELECT id, workspace_id, provider, label, status, verified_at, created_at, updated_at,
		        metadata_encrypted
		 FROM provisr_cloud.cloud_accounts WHERE id = $1 AND workspace_id = $2`,
		id, workspaceID,
	).Scan(&account.ID, &account.WorkspaceID, &account.Provider, &account.Label, &account.Status,
		&verifiedAt, &account.CreatedAt, &account.UpdatedAt, &metadataEncrypted)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			s.writeError(r.Context(), w, http.StatusNotFound, "not_found", "cloud account not found")
			return
		}
		log.Error().Err(err).Msg("failed to get cloud account")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to get cloud account")
		return
	}
	if verifiedAt.Valid {
		account.VerifiedAt = &verifiedAt.String
	}

	workspaceKey, err := s.workspaceKey(r.Context(), account.WorkspaceID)
	if err != nil {
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to derive encryption key")
		return
	}

	// Authorized consumers only: the endpoint intentionally decrypts. The
	// caller is responsible for restricting access (see design discussion #26).
	metadata := map[string]any{}
	if err := cloudcrypto.DecryptJSON(workspaceKey, metadataEncrypted.String, &metadata); err != nil {
		log.Error().Err(err).Str("account_id", id).Msg("failed to decrypt account metadata")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to decrypt account metadata")
		return
	}

	response := map[string]any{
		"id": account.ID, "workspace_id": account.WorkspaceID, "provider": account.Provider,
		"label": account.Label, "status": account.Status, "metadata": metadata,
		"created_at": account.CreatedAt, "updated_at": account.UpdatedAt,
	}
	if account.VerifiedAt != nil {
		response["verified_at"] = *account.VerifiedAt
	}
	s.writeJSON(r.Context(), w, http.StatusOK, response)
}

func (s *server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	log := zerolog.Ctx(r.Context())
	workspaceID, ok := s.requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "id must be a valid UUID")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req statusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	if !validStatuses[req.Status] {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "status must be pending, active, failed, or disconnected")
		return
	}

	// verified_at is set when an account transitions into active.
	result, err := s.db.Exec(
		`UPDATE provisr_cloud.cloud_accounts
		 SET status = $1::provisr_cloud.account_status,
		     verified_at = CASE WHEN $1 = 'active' THEN now() ELSE verified_at END,
		     updated_at = now()
		 WHERE id = $2 AND workspace_id = $3`,
		req.Status, id, workspaceID,
	)
	if err != nil {
		log.Error().Err(err).Msg("failed to update cloud account status")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to update cloud account status")
		return
	}
	affected, err := result.RowsAffected()
	if err != nil {
		log.Error().Err(err).Msg("failed to read affected rows")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to update cloud account status")
		return
	}
	if affected == 0 {
		s.writeError(r.Context(), w, http.StatusNotFound, "not_found", "cloud account not found")
		return
	}

	s.writeJSON(r.Context(), w, http.StatusOK, map[string]string{"id": id, "status": req.Status})
}

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	log := zerolog.Ctx(r.Context())
	workspaceID, ok := s.requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "id must be a valid UUID")
		return
	}

	// Block deletion while non-terminal provisioning runs exist in the
	// workspace (provisioning_runs does not yet carry a cloud_account_id FK;
	// see design discussion #26).
	var accountWorkspaceID string
	err := s.db.QueryRow(
		`SELECT workspace_id FROM provisr_cloud.cloud_accounts WHERE id = $1 AND workspace_id = $2`,
		id, workspaceID,
	).Scan(&accountWorkspaceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			s.writeError(r.Context(), w, http.StatusNotFound, "not_found", "cloud account not found")
			return
		}
		log.Error().Err(err).Msg("failed to read cloud account for deletion")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}

	var activeRuns bool
	err = s.db.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM provisr_state.provisioning_runs
			WHERE workspace_id = $1 AND state NOT IN ('completed', 'failed', 'cancelled')
			LIMIT 1
		)`,
		accountWorkspaceID,
	).Scan(&activeRuns)
	if err != nil {
		log.Error().Err(err).Msg("failed to check active runs")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}
	if activeRuns {
		s.writeError(r.Context(), w, http.StatusConflict, "active_runs_exist", "cannot delete cloud account with active provisioning runs")
		return
	}

	if _, err := s.db.Exec(`DELETE FROM provisr_cloud.cloud_accounts WHERE id = $1 AND workspace_id = $2`, id, workspaceID); err != nil {
		log.Error().Err(err).Msg("failed to delete cloud account")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func isUniqueViolation(err error) bool {
	return strings.Contains(err.Error(), "duplicate key value violates unique constraint")
}

func isForeignKeyViolation(err error) bool {
	return strings.Contains(err.Error(), "violates foreign key constraint")
}

func (s *server) recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				zerolog.Ctx(r.Context()).Error().Interface("panic", rec).Str("path", r.URL.Path).Msg("panic recovered")
				s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "unexpected server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// loggingMiddleware derives a request-scoped logger carrying request_id and
// correlation_id, read from headers or generated when absent, so every log
// line can be correlated across services.
func loggingMiddleware(base zerolog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.NewString()
		}
		correlationID := r.Header.Get("X-Correlation-ID")
		if _, err := uuid.Parse(correlationID); err != nil {
			correlationID = requestID
		}

		l := base.With().Str("request_id", requestID).Str("correlation_id", correlationID).Logger()
		ctx := l.WithContext(r.Context())
		ctx = context.WithValue(ctx, requestIDKey, requestID)
		ctx = context.WithValue(ctx, correlationIDKey, correlationID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *server) writeJSON(ctx context.Context, w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		zerolog.Ctx(ctx).Error().Err(err).Msg("failed to encode response")
	}
}

func (s *server) writeError(ctx context.Context, w http.ResponseWriter, status int, code, message string) {
	s.writeJSON(ctx, w, status, errorResponse{Error: code, Message: message, Status: status})
}
