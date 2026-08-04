package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/provisr/backend/pkg/cloudcrypto"
	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

const (
	defaultPort = "8089"
	maxBody     = 1 << 20
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

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		dbDSN = "postgres://localhost:5432/provisr?sslmode=disable"
	}

	masterKeyHex := os.Getenv("CLOUD_ACCOUNT_MASTER_KEY")
	if masterKeyHex == "" {
		log.Fatal("CLOUD_ACCOUNT_MASTER_KEY is required (64 hex characters)")
	}
	master, err := cloudcrypto.ParseMasterKey(masterKeyHex)
	if err != nil {
		log.Fatalf("invalid CLOUD_ACCOUNT_MASTER_KEY: %v", err)
	}

	logger := zerolog.New(os.Stdout).With().Timestamp().Str("service", "cloud-account-service").Logger()

	db, err := sql.Open("postgres", dbDSN)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to open database connection")
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		logger.Fatal().Err(err).Msg("failed to ping database")
	}

	s := &server{db: db, log: logger, master: master}

	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())

	mux.HandleFunc("POST /v1/cloud-accounts", s.handleCreate)
	mux.HandleFunc("GET /v1/cloud-accounts", s.handleList)
	mux.HandleFunc("GET /v1/cloud-accounts/{id}", s.handleGet)
	mux.HandleFunc("PATCH /v1/cloud-accounts/{id}/status", s.handleUpdateStatus)
	mux.HandleFunc("DELETE /v1/cloud-accounts/{id}", s.handleDelete)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      recoveryMiddleware(logger, mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	logger.Info().Str("port", port).Msg("cloud-account-service starting")
	log.Fatal(srv.ListenAndServe())
}

type server struct {
	db     *sql.DB
	log    zerolog.Logger
	master cloudcrypto.MasterKey
}

func (s *server) workspaceKey(workspaceID string) ([]byte, error) {
	key, err := cloudcrypto.DeriveWorkspaceKey(s.master, workspaceID)
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", workspaceID).Msg("failed to derive workspace key")
		return nil, err
	}
	return key, nil
}

func (s *server) handleCreate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if !validProviders[req.Provider] {
		writeError(w, http.StatusBadRequest, "validation_error", "provider must be aws, azure, or gcp")
		return
	}
	if strings.TrimSpace(req.Label) == "" || len(req.Label) > 255 {
		writeError(w, http.StatusBadRequest, "validation_error", "label must be between 1 and 255 characters")
		return
	}
	if _, err := uuid.Parse(req.WorkspaceID); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}
	if req.Metadata == nil {
		req.Metadata = map[string]any{}
	}
	if req.ExternalAccountID != "" && req.Provider != "aws" {
		writeError(w, http.StatusBadRequest, "validation_error", "external_account_id is only valid for aws accounts")
		return
	}

	workspaceKey, err := s.workspaceKey(req.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to derive encryption key")
		return
	}

	encrypted, err := cloudcrypto.EncryptJSON(workspaceKey, req.Metadata)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to encrypt metadata")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to encrypt account metadata")
		return
	}

	var externalIDHash *string
	if req.ExternalAccountID != "" {
		hash, err := cloudcrypto.HashExternalID(workspaceKey, req.ExternalAccountID)
		if err != nil {
			s.log.Error().Err(err).Msg("failed to hash external account id")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to hash external account id")
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
			writeError(w, http.StatusConflict, "provider_slot_taken",
				fmt.Sprintf("workspace already has a %s account; delete or reconnect it first", req.Provider))
			return
		}
		if isForeignKeyViolation(err) {
			writeError(w, http.StatusBadRequest, "workspace_not_found", "workspace does not exist")
			return
		}
		s.log.Error().Err(err).Msg("failed to insert cloud account")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create cloud account")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"id": insertedID, "workspace_id": req.WorkspaceID, "provider": req.Provider,
		"label": strings.TrimSpace(req.Label), "status": "pending",
	})
}

// tryRetryPending updates metadata of an existing pending account for the same
// workspace/provider pair, returning true when the retry succeeded.
func (s *server) tryRetryPending(w http.ResponseWriter, _ *http.Request, req createRequest, encrypted string, externalIDHash *string) bool {
	var existingID string
	var existingStatus string
	err := s.db.QueryRow(
		`SELECT id, status FROM provisr_cloud.cloud_accounts
		 WHERE workspace_id = $1 AND provider = $2`,
		req.WorkspaceID, req.Provider,
	).Scan(&existingID, &existingStatus)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to read existing account for retry")
		return false
	}
	if existingStatus != "pending" {
		return false
	}

	_, err = s.db.Exec(
		`UPDATE provisr_cloud.cloud_accounts
		 SET metadata_encrypted = $1, external_account_id_hash = $2, label = $3, updated_at = now()
		 WHERE id = $4 AND status = 'pending'`,
		encrypted, externalIDHash, strings.TrimSpace(req.Label), existingID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to retry pending account")
		return false
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"id": existingID, "workspace_id": req.WorkspaceID, "provider": req.Provider,
		"label": strings.TrimSpace(req.Label), "status": "pending",
	})
	return true
}

func (s *server) handleList(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "workspace_id query parameter is required")
		return
	}
	if _, err := uuid.Parse(workspaceID); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
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
		s.log.Error().Err(err).Msg("failed to list cloud accounts")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list cloud accounts")
		return
	}
	defer rows.Close()

	accounts := []listCloudAccount{}
	for rows.Next() {
		var a listCloudAccount
		var verifiedAt sql.NullString
		if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.Provider, &a.Label, &a.Status, &verifiedAt, &a.CreatedAt, &a.UpdatedAt); err != nil {
			s.log.Error().Err(err).Msg("failed to scan cloud account")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to list cloud accounts")
			return
		}
		if verifiedAt.Valid {
			a.VerifiedAt = &verifiedAt.String
		}
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		s.log.Error().Err(err).Msg("failed to iterate cloud accounts")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list cloud accounts")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
}

func (s *server) handleGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "id must be a valid UUID")
		return
	}

	var account cloudAccount
	var verifiedAt, metadataEncrypted sql.NullString
	err := s.db.QueryRow(
		`SELECT id, workspace_id, provider, label, status, verified_at, created_at, updated_at,
		        metadata_encrypted
		 FROM provisr_cloud.cloud_accounts WHERE id = $1`,
		id,
	).Scan(&account.ID, &account.WorkspaceID, &account.Provider, &account.Label, &account.Status,
		&verifiedAt, &account.CreatedAt, &account.UpdatedAt, &metadataEncrypted)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "cloud account not found")
			return
		}
		s.log.Error().Err(err).Msg("failed to get cloud account")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to get cloud account")
		return
	}
	if verifiedAt.Valid {
		account.VerifiedAt = &verifiedAt.String
	}

	workspaceKey, err := s.workspaceKey(account.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to derive encryption key")
		return
	}

	// Authorized consumers only: the endpoint intentionally decrypts. The
	// caller is responsible for restricting access (see design discussion #24).
	metadata := map[string]any{}
	if err := cloudcrypto.DecryptJSON(workspaceKey, metadataEncrypted.String, &metadata); err != nil {
		s.log.Error().Err(err).Str("account_id", id).Msg("failed to decrypt account metadata")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to decrypt account metadata")
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
	writeJSON(w, http.StatusOK, response)
}

func (s *server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "id must be a valid UUID")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req statusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	if !validStatuses[req.Status] {
		writeError(w, http.StatusBadRequest, "validation_error", "status must be pending, active, failed, or disconnected")
		return
	}

	// verified_at is set when an account transitions into active.
	result, err := s.db.Exec(
		`UPDATE provisr_cloud.cloud_accounts
		 SET status = $1::provisr_cloud.account_status,
		     verified_at = CASE WHEN $1 = 'active' THEN now() ELSE verified_at END,
		     updated_at = now()
		 WHERE id = $2`,
		req.Status, id,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to update cloud account status")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update cloud account status")
		return
	}
	affected, err := result.RowsAffected()
	if err != nil {
		s.log.Error().Err(err).Msg("failed to read affected rows")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update cloud account status")
		return
	}
	if affected == 0 {
		writeError(w, http.StatusNotFound, "not_found", "cloud account not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": req.Status})
}

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "id must be a valid UUID")
		return
	}

	// Block deletion while non-terminal provisioning runs exist in the
	// workspace (provisioning_runs does not yet carry a cloud_account_id FK;
	// see design discussion #24).
	var workspaceID string
	err := s.db.QueryRow(
		`SELECT workspace_id FROM provisr_cloud.cloud_accounts WHERE id = $1`,
		id,
	).Scan(&workspaceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "cloud account not found")
			return
		}
		s.log.Error().Err(err).Msg("failed to read cloud account for deletion")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}

	var activeRuns bool
	err = s.db.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM provisr_state.provisioning_runs
			WHERE workspace_id = $1 AND state NOT IN ('completed', 'failed', 'cancelled')
			LIMIT 1
		)`,
		workspaceID,
	).Scan(&activeRuns)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check active runs")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
		return
	}
	if activeRuns {
		writeError(w, http.StatusConflict, "active_runs_exist", "cannot delete cloud account with active provisioning runs")
		return
	}

	if _, err := s.db.Exec(`DELETE FROM provisr_cloud.cloud_accounts WHERE id = $1`, id); err != nil {
		s.log.Error().Err(err).Msg("failed to delete cloud account")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to delete cloud account")
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

func recoveryMiddleware(log zerolog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Error().Interface("panic", rec).Str("path", r.URL.Path).Msg("panic recovered")
				writeError(w, http.StatusInternalServerError, "internal_error", "unexpected server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: code, Message: message, Status: status})
}
