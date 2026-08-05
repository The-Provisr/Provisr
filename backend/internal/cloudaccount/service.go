// Package cloudaccount implements the cloud-account-service HTTP API:
// encrypted storage and lookup of per-workspace cloud provider accounts.
package cloudaccount

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
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
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
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Provider    string  `json:"provider"`
	Label       string  `json:"label"`
	Status      string  `json:"status"`
	VerifiedAt  *string `json:"verified_at,omitempty"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
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

var (
	errIdempotencyKeyMissing = errors.New("idempotency key missing")
	errIdempotencyKeyUsed    = errors.New("idempotency key already used")
)

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

	// loggingMiddleware wraps recoveryMiddleware so panic handling runs inside
	// the request-scoped logger and panic logs carry request_id and
	// correlation_id.
	return loggingMiddleware(log, s.recoveryMiddleware(mux))
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
	tx, err := s.db.Begin()
	if err != nil {
		log.Error().Err(err).Msg("failed to begin transaction")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to create cloud account")
		return
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.claimIdempotencyKey(r.Context(), tx, r, req.WorkspaceID, "cloud_account.create"); err != nil {
		s.writeIdempotencyError(w, r, err)
		return
	}

	insertedID := ""
	err = tx.QueryRow(
		`INSERT INTO provisr_cloud.cloud_accounts
		   (workspace_id, provider, label, external_account_id_hash, metadata_encrypted, status)
		 VALUES ($1, $2, $3, $4, $5, 'pending')
		 RETURNING id`,
		req.WorkspaceID, req.Provider, strings.TrimSpace(req.Label), externalIDHash, encrypted,
	).Scan(&insertedID)
	if err != nil {
		if isUniqueViolation(err) {
			retryID, retried, retryErr := s.tryRetryPending(r.Context(), tx, req, encrypted, externalIDHash)
			if retryErr != nil {
				log.Error().Err(retryErr).Msg("failed to retry pending account")
				s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to create cloud account")
				return
			}
			if retried {
				// Commit before writing the response: a failed commit must not
				// present a success that was rolled back.
				if err := tx.Commit(); err != nil {
					log.Error().Err(err).Msg("failed to commit retry transaction")
					s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to create cloud account")
					return
				}
				s.writeJSON(r.Context(), w, http.StatusOK, map[string]string{
					"id": retryID, "workspace_id": req.WorkspaceID, "provider": req.Provider,
					"label": strings.TrimSpace(req.Label), "status": "pending",
				})
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

	if err := s.emitAudit(r.Context(), tx, req.WorkspaceID, "cloud_account_created", insertedID, map[string]any{
		"provider": req.Provider,
		"label":    strings.TrimSpace(req.Label),
	}); err != nil {
		log.Error().Err(err).Msg("failed to emit audit event")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to create cloud account")
		return
	}

	if err := tx.Commit(); err != nil {
		log.Error().Err(err).Msg("failed to commit transaction")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to create cloud account")
		return
	}

	s.writeJSON(r.Context(), w, http.StatusCreated, map[string]string{
		"id": insertedID, "workspace_id": req.WorkspaceID, "provider": req.Provider,
		"label": strings.TrimSpace(req.Label), "status": "pending",
	})
}

// tryRetryPending updates metadata of an existing pending account for the same
// workspace/provider pair. It performs only database work: it returns the
// recovered account id and true when the retry succeeded, false when no
// pending row matched, and an error for genuine database or audit failures.
// The status read and the guarded update are one atomic statement: a
// concurrent status change between the two would otherwise make the retry
// report success after updating zero rows.
func (s *server) tryRetryPending(ctx context.Context, tx *sql.Tx, req createRequest, encrypted string, externalIDHash *string) (string, bool, error) {
	log := zerolog.Ctx(ctx)
	var existingID string
	err := tx.QueryRow(
		`UPDATE provisr_cloud.cloud_accounts
		 SET metadata_encrypted = $1, external_account_id_hash = $2, label = $3, updated_at = now()
		 WHERE workspace_id = $4 AND provider = $5 AND status = 'pending'
		 RETURNING id`,
		encrypted, externalIDHash, strings.TrimSpace(req.Label), req.WorkspaceID, req.Provider,
	).Scan(&existingID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		log.Error().Err(err).Msg("failed to retry pending account")
		return "", false, err
	}

	if err := s.emitAudit(ctx, tx, req.WorkspaceID, "cloud_account_created", existingID, map[string]any{
		"provider": req.Provider,
		"label":    strings.TrimSpace(req.Label),
		"retried":  true,
	}); err != nil {
		log.Error().Err(err).Msg("failed to emit audit event")
		return "", false, err
	}

	return existingID, true, nil
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
		var verifiedAt sql.NullTime
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.Provider, &a.Label, &a.Status, &verifiedAt, &createdAt, &updatedAt); err != nil {
			log.Error().Err(err).Msg("failed to scan cloud account")
			s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to list cloud accounts")
			return
		}
		a.CreatedAt = createdAt.Format(time.RFC3339Nano)
		a.UpdatedAt = updatedAt.Format(time.RFC3339Nano)
		if verifiedAt.Valid {
			v := verifiedAt.Time.Format(time.RFC3339Nano)
			a.VerifiedAt = &v
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
	var verifiedAt sql.NullTime
	var createdAt, updatedAt time.Time
	var metadataEncrypted sql.NullString
	err := s.db.QueryRow(
		`SELECT id, workspace_id, provider, label, status, verified_at, created_at, updated_at,
		        metadata_encrypted
		 FROM provisr_cloud.cloud_accounts WHERE id = $1 AND workspace_id = $2`,
		id, workspaceID,
	).Scan(&account.ID, &account.WorkspaceID, &account.Provider, &account.Label, &account.Status,
		&verifiedAt, &createdAt, &updatedAt, &metadataEncrypted)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			s.writeError(r.Context(), w, http.StatusNotFound, "not_found", "cloud account not found")
			return
		}
		log.Error().Err(err).Msg("failed to get cloud account")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to get cloud account")
		return
	}
	account.CreatedAt = createdAt.Format(time.RFC3339Nano)
	account.UpdatedAt = updatedAt.Format(time.RFC3339Nano)
	if verifiedAt.Valid {
		v := verifiedAt.Time.Format(time.RFC3339Nano)
		account.VerifiedAt = &v
	}

	workspaceKey, err := s.workspaceKey(r.Context(), account.WorkspaceID)
	if err != nil {
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to derive encryption key")
		return
	}

	// Authorized consumers only: the endpoint intentionally decrypts. The
	// caller is responsible for restricting access (see design discussion #26).
	// An empty value (pre-encryption backfill or legacy row) returns {} instead
	// of failing the request.
	metadata := map[string]any{}
	if metadataEncrypted.Valid && metadataEncrypted.String != "" {
		if err := cloudcrypto.DecryptJSON(workspaceKey, metadataEncrypted.String, &metadata); err != nil {
			log.Error().Err(err).Str("account_id", id).Msg("failed to decrypt account metadata")
			s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to decrypt account metadata")
			return
		}
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
	tx, err := s.db.Begin()
	if err != nil {
		log.Error().Err(err).Msg("failed to begin transaction")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to update cloud account status")
		return
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.claimIdempotencyKey(r.Context(), tx, r, workspaceID, "cloud_account.update_status"); err != nil {
		s.writeIdempotencyError(w, r, err)
		return
	}

	result, err := tx.Exec(
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

	if err := s.emitAudit(r.Context(), tx, workspaceID, "cloud_account_status_changed", id, map[string]any{
		"status": req.Status,
	}); err != nil {
		log.Error().Err(err).Msg("failed to emit audit event")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to update cloud account status")
		return
	}

	if err := tx.Commit(); err != nil {
		log.Error().Err(err).Msg("failed to commit transaction")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to update cloud account status")
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
	tx, err := s.db.Begin()
	if err != nil {
		log.Error().Err(err).Msg("failed to begin transaction")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.claimIdempotencyKey(r.Context(), tx, r, workspaceID, "cloud_account.delete"); err != nil {
		s.writeIdempotencyError(w, r, err)
		return
	}

	var accountWorkspaceID, provider string
	err = tx.QueryRow(
		`SELECT workspace_id, provider FROM provisr_cloud.cloud_accounts WHERE id = $1 AND workspace_id = $2`,
		id, workspaceID,
	).Scan(&accountWorkspaceID, &provider)
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
	err = tx.QueryRow(
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

	// The delete is conditional on no active runs so a run starting between
	// the guard above and this statement cannot leave an account deleted
	// while a run depends on it.
	result, err := tx.Exec(
		`DELETE FROM provisr_cloud.cloud_accounts ca
		 WHERE ca.id = $1 AND ca.workspace_id = $2
		   AND NOT EXISTS (
		     SELECT 1 FROM provisr_state.provisioning_runs pr
		     WHERE pr.workspace_id = ca.workspace_id
		       AND pr.state NOT IN ('completed', 'failed', 'cancelled')
		   )`,
		id, workspaceID,
	)
	if err != nil {
		log.Error().Err(err).Msg("failed to delete cloud account")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}
	affected, err := result.RowsAffected()
	if err != nil {
		log.Error().Err(err).Msg("failed to read affected rows")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}
	if affected == 0 {
		s.writeError(r.Context(), w, http.StatusConflict, "active_runs_exist", "cannot delete cloud account with active provisioning runs")
		return
	}

	if err := s.emitAudit(r.Context(), tx, workspaceID, "cloud_account_deleted", id, map[string]any{
		"provider": provider,
	}); err != nil {
		log.Error().Err(err).Msg("failed to emit audit event")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}

	if err := tx.Commit(); err != nil {
		log.Error().Err(err).Msg("failed to commit transaction")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// PostgreSQL SQLSTATE codes are locale-independent, unlike the human-readable
// error strings that lc_messages can localize.
const (
	sqlStateUniqueViolation     = "23505"
	sqlStateForeignKeyViolation = "23503"
)

// claimIdempotencyKey reserves the Idempotency-Key header for a mutation
// within the transaction. A missing or oversized key is rejected before any
// state change; a key that was already consumed by a previous mutation is
// rejected so a mutation is never applied twice.
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
		s.writeError(r.Context(), w, http.StatusBadRequest, "idempotency_key_required", "Idempotency-Key header is required for mutations")
	case errors.Is(err, errIdempotencyKeyUsed):
		s.writeError(r.Context(), w, http.StatusConflict, "duplicate_idempotency_key", "Idempotency-Key was already used for a mutation")
	default:
		log.Error().Err(err).Msg("failed to claim idempotency key")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to process mutation")
	}
}

// emitAudit appends an immutable, hash-chained audit event for a mutation,
// inside the same transaction as the mutation itself.
func (s *server) emitAudit(ctx context.Context, tx *sql.Tx, workspaceID, eventType, resourceID string, payload map[string]any) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal audit payload: %w", err)
	}

	var previousHash sql.NullString
	// Serialize chain appends with a transaction-scoped advisory lock so two
	// concurrent mutations cannot read the same tail and fork the chain on the
	// same previous_hash. The lock is released when the transaction commits or
	// rolls back.
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtext('provisr_audit.chain'), 0)`); err != nil {
		return fmt.Errorf("acquire audit chain lock: %w", err)
	}
	// The chain is global across workspaces (single previous_hash linkage);
	// seq is the monotonic insertion order, unlike created_at which can tie.
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
		 VALUES ($1, $2::provisr_audit.event_type, $3, 'system', 'cloud_account', $4, $5, $6, $7, $8)`,
		workspaceID, eventType, "cloud-account-service", resourceID, payloadJSON, eventHash, prev, correlationID,
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

func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == sqlStateUniqueViolation
}

func isForeignKeyViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == sqlStateForeignKeyViolation
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
