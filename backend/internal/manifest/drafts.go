// Package manifest owns BE-D01/D02 immutable manifest validation and storage.
//
// This file is the private orchestrator draft API (POST /v1/manifests) served
// by state-service: it validates drafts against run snapshots and stores them
// idempotently with an audit event. service.go is the manifest-service API.
package manifest

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/provisr/backend/pkg/health"
	"github.com/provisr/backend/pkg/secretscan"
)

type Context struct {
	WorkspaceID    string   `json:"workspace_id"`
	UserID         string   `json:"user_id"`
	Permissions    []string `json:"permissions"`
	RequestID      string   `json:"request_id"`
	CorrelationID  string   `json:"correlation_id"`
	SessionID      string   `json:"session_id"`
	IdempotencyKey string   `json:"idempotency_key"`
}
type draftRequest struct {
	Context              Context         `json:"context"`
	RunID                string          `json:"run_id"`
	ExpectedStateVersion int             `json:"expected_state_version"`
	Content              json.RawMessage `json:"content"`
}
type draftServer struct {
	db            *sql.DB
	client        *http.Client
	mcpURL, token string
}

func NewDraftHandler(db *sql.DB, client *http.Client, mcpURL, token string) http.Handler {
	s := &draftServer{db: db, client: client, mcpURL: strings.TrimRight(mcpURL, "/"), token: token}
	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())
	mux.HandleFunc("POST /v1/manifests", s.store)
	mux.HandleFunc("POST /v1/manifests/validate", s.validate)
	return mux
}
func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"message": message})
}

func (s *draftServer) readRequest(w http.ResponseWriter, r *http.Request) (draftRequest, bool) {
	var body draftRequest
	// This is a private orchestrator API, never a user manifest-editing route.
	if s.token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
		fail(w, http.StatusUnauthorized, "Orchestration authorization required")
		return body, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, http.StatusBadRequest, "Invalid draft request")
		return body, false
	}
	for _, id := range []string{body.RunID, body.Context.WorkspaceID, body.Context.UserID, body.Context.RequestID, body.Context.CorrelationID, body.Context.SessionID} {
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 400, "Invalid context identifier")
			return body, false
		}
	}
	if body.Context.RequestID != body.RunID || body.ExpectedStateVersion < 0 || strings.TrimSpace(body.Context.IdempotencyKey) == "" || len(body.Context.IdempotencyKey) > 255 {
		fail(w, 400, "Invalid context or idempotency key")
		return body, false
	}
	var authorized bool
	err := s.db.QueryRowContext(r.Context(), `SELECT EXISTS (
      SELECT 1 FROM provisr_identity.memberships m JOIN provisr_identity.workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role IN ('admin','engineer') AND w.deleted_at IS NULL
    )`, body.Context.WorkspaceID, body.Context.UserID).Scan(&authorized)
	if err != nil {
		fail(w, 503, "Manifest storage unavailable")
		return body, false
	}
	if !authorized {
		fail(w, 403, "Provisioning permission required")
		return body, false
	}
	return body, true
}

// Snapshots come from the run, not from the caller's mutable request body.
func (s *draftServer) validateDraft(r *http.Request, body draftRequest) (bool, []string, error) {
	var cloud, policy json.RawMessage
	var session, correlation, requester, state string
	var version int
	err := s.db.QueryRowContext(r.Context(), `SELECT cloud_context, policy_requirements, session_id, correlation_id, requester_id, state, state_version
      FROM provisr_state.provisioning_runs WHERE id = $1 AND workspace_id = $2`, body.RunID, body.Context.WorkspaceID).
		Scan(&cloud, &policy, &session, &correlation, &requester, &state, &version)
	if err != nil {
		return false, nil, err
	}
	if session != body.Context.SessionID || correlation != body.Context.CorrelationID || requester != body.Context.UserID || state != "MANIFEST_CREATING" || version != body.ExpectedStateVersion {
		return false, []string{"Run context or version changed"}, nil
	}
	payload, err := json.Marshal(map[string]any{"context": body.Context, "manifest": body.Content, "cloud_context": cloud, "policy_context": policy})
	if err != nil {
		return false, nil, err
	}
	for _, tool := range []string{"validate_manifest", "validate_manifest_schema"} {
		request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, s.mcpURL+"/tools/"+tool, bytes.NewReader(payload))
		if err != nil {
			return false, nil, err
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := s.client.Do(request)
		if err != nil {
			return false, nil, err
		}
		var result struct {
			Valid  bool     `json:"valid"`
			Errors []string `json:"errors"`
		}
		err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 {
			return false, nil, errors.New("manifest validator unavailable")
		}
		if !result.Valid {
			return false, result.Errors, nil
		}
	}
	return true, nil, nil
}

func (s *draftServer) validate(w http.ResponseWriter, r *http.Request) {
	body, ok := s.readRequest(w, r)
	if !ok {
		return
	}
	if findings, ok := scanDraft(w, body); !ok || len(findings) > 0 {
		if ok {
			respond(w, 422, (&secretscan.BlockedError{Kind: "manifest", Findings: findings}).Body())
		}
		return
	}
	valid, validationErrors, err := s.validateDraft(r, body)
	if err != nil {
		fail(w, 503, "Manifest validation unavailable")
		return
	}
	respond(w, 200, map[string]any{"valid": valid, "errors": validationErrors})
}

func (s *draftServer) store(w http.ResponseWriter, r *http.Request) {
	body, ok := s.readRequest(w, r)
	if !ok {
		return
	}
	// Replays remain available after the run has advanced, without revalidating a stale version.
	var existingVersion int
	var sameContent bool
	err := s.db.QueryRowContext(r.Context(), `SELECT version, content = $3::jsonb FROM provisr_manifest.manifests
      WHERE run_id = $1 AND idempotency_key = $2`, body.RunID, body.Context.IdempotencyKey, []byte(body.Content)).Scan(&existingVersion, &sameContent)
	if err == nil {
		if !sameContent {
			fail(w, 409, "Idempotency key already used for a different draft")
			return
		}
		// The key is scoped to a run, whose workspace/requester must still match.
		var owned bool
		err = s.db.QueryRowContext(r.Context(), `SELECT EXISTS (SELECT 1 FROM provisr_state.provisioning_runs
          WHERE id = $1 AND workspace_id = $2 AND requester_id = $3)`, body.RunID, body.Context.WorkspaceID, body.Context.UserID).Scan(&owned)
		if err != nil || !owned {
			fail(w, 403, "Run context mismatch")
			return
		}
		respond(w, 200, map[string]int{"version": existingVersion})
		return
	}
	if err != sql.ErrNoRows {
		fail(w, 503, "Manifest storage unavailable")
		return
	}
	// BE-D06: a manifest carrying secrets is never stored; only the audited
	// finding locations are kept.
	findings, ok := scanDraft(w, body)
	if !ok {
		return
	}
	if len(findings) > 0 {
		s.blockSecrets(w, r, body, findings)
		return
	}
	valid, validationErrors, err := s.validateDraft(r, body)
	if err != nil {
		fail(w, 503, "Manifest validation unavailable")
		return
	}
	if !valid {
		respond(w, 422, map[string]any{"valid": false, "errors": validationErrors})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "Manifest storage unavailable")
		return
	}
	defer func() { _ = tx.Rollback() }()
	// Validation performs remote calls. Recheck and lock authorization before
	// writing, so membership revocation cannot race a stored draft.
	var role string
	err = tx.QueryRowContext(r.Context(), `SELECT m.role::text FROM provisr_identity.memberships m
      JOIN provisr_identity.workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL FOR SHARE OF m, w`,
		body.Context.WorkspaceID, body.Context.UserID).Scan(&role)
	if err != nil || (role != "admin" && role != "engineer") {
		fail(w, 403, "Provisioning permission required")
		return
	}
	var state string
	var stateVersion int
	err = tx.QueryRowContext(r.Context(), `SELECT state, state_version FROM provisr_state.provisioning_runs
      WHERE id = $1 AND workspace_id = $2 AND requester_id = $3 FOR UPDATE`, body.RunID, body.Context.WorkspaceID, body.Context.UserID).Scan(&state, &stateVersion)
	if err != nil || state != "MANIFEST_CREATING" || stateVersion != body.ExpectedStateVersion {
		fail(w, 409, "Run state or version changed")
		return
	}
	// Serialize version allocation with the locked run, including concurrent replays.
	err = tx.QueryRowContext(r.Context(), `SELECT version, content = $3::jsonb FROM provisr_manifest.manifests
      WHERE run_id = $1 AND idempotency_key = $2`, body.RunID, body.Context.IdempotencyKey, []byte(body.Content)).Scan(&existingVersion, &sameContent)
	if err == nil {
		if !sameContent {
			fail(w, 409, "Idempotency key already used for a different draft")
			return
		}
		respond(w, 200, map[string]int{"version": existingVersion})
		return
	}
	if err != sql.ErrNoRows {
		fail(w, 503, "Manifest storage unavailable")
		return
	}
	var version int
	err = tx.QueryRowContext(r.Context(), `INSERT INTO provisr_manifest.manifests (run_id, version, content, idempotency_key)
      SELECT $1, COALESCE(MAX(version), 0) + 1, $2::jsonb, $3 FROM provisr_manifest.manifests WHERE run_id = $1 RETURNING version`, body.RunID, []byte(body.Content), body.Context.IdempotencyKey).Scan(&version)
	if err != nil {
		fail(w, 503, "Manifest storage unavailable")
		return
	}
	payload, _ := json.Marshal(map[string]any{"manifest_version": version, "run_id": body.RunID})
	if _, err = tx.ExecContext(r.Context(), "SELECT pg_advisory_xact_lock(hashtext('provisr_audit.chain'), 0)"); err != nil {
		fail(w, 503, "Manifest audit unavailable")
		return
	}
	var previous sql.NullString
	err = tx.QueryRowContext(r.Context(), "SELECT hash FROM provisr_audit.audit_events ORDER BY seq DESC LIMIT 1").Scan(&previous)
	if err != nil && err != sql.ErrNoRows {
		fail(w, 503, "Manifest audit unavailable")
		return
	}
	sum := sha256.Sum256([]byte(previous.String + "|" + body.Context.WorkspaceID + "|manifest_created|" + body.RunID + "|" + string(payload) + "|" + body.Context.CorrelationID))
	var previousValue any
	if previous.Valid {
		previousValue = previous.String
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO provisr_audit.audit_events (workspace_id, event_type, actor_id, actor_type, resource_type, resource_id, payload, hash, previous_hash, correlation_id)
      VALUES ($1,'manifest_created','state-service','system','provisioning_run',$2,$3,$4,$5,$6)`, body.Context.WorkspaceID, body.RunID, payload, hex.EncodeToString(sum[:]), previousValue, body.Context.CorrelationID)
	if err != nil {
		fail(w, 503, "Manifest audit unavailable")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "Manifest storage unavailable")
		return
	}
	respond(w, 201, map[string]int{"version": version})
}

func scanDraft(w http.ResponseWriter, body draftRequest) ([]secretscan.Finding, bool) {
	findings, err := secretscan.ScanJSON("manifest", body.Content)
	if err != nil {
		fail(w, 400, "Invalid draft request")
		return nil, false
	}
	return findings, true
}

func (s *draftServer) blockSecrets(w http.ResponseWriter, r *http.Request, body draftRequest, findings []secretscan.Finding) {
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "Manifest audit unavailable")
		return
	}
	defer func() { _ = tx.Rollback() }()
	// Audit only against a run the caller owns, so findings cannot be written
	// into another workspace's chain.
	var owned bool
	err = tx.QueryRowContext(r.Context(), `SELECT EXISTS (SELECT 1 FROM provisr_state.provisioning_runs
      WHERE id = $1 AND workspace_id = $2 AND requester_id = $3)`, body.RunID, body.Context.WorkspaceID, body.Context.UserID).Scan(&owned)
	if err != nil {
		fail(w, 503, "Manifest audit unavailable")
		return
	}
	if !owned {
		fail(w, 403, "Run context mismatch")
		return
	}
	err = secretscan.RecordFindings(r.Context(), tx, secretscan.AuditInput{WorkspaceID: body.Context.WorkspaceID,
		CorrelationID: body.Context.CorrelationID, ActorID: "state-service", ResourceType: "provisioning_run",
		ResourceID: body.RunID, ArtifactKind: "manifest", Action: secretscan.ActionBlocked, Findings: findings})
	if err != nil || tx.Commit() != nil {
		fail(w, 503, "Manifest audit unavailable")
		return
	}
	respond(w, 422, (&secretscan.BlockedError{Kind: "manifest", Findings: findings}).Body())
}
