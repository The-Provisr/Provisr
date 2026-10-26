package statebackend

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/provisr/backend/internal/cloudaccount"
	"github.com/provisr/backend/pkg/cloudcrypto"
)

// Context is the trusted caller context forwarded by orchestration.
type Context struct {
	WorkspaceID    string   `json:"workspace_id"`
	UserID         string   `json:"user_id"`
	CorrelationID  string   `json:"correlation_id"`
	IdempotencyKey string   `json:"idempotency_key"`
	Permissions    []string `json:"permissions"`
}

type Request struct {
	Provider string  `json:"provider"`
	Context  Context `json:"context"`
}

// Result is the only shape callers see: no bucket names, keys or credentials.
type Result struct {
	ID         string    `json:"state_backend_id"`
	Provider   string    `json:"provider"`
	Status     string    `json:"status"`
	Created    bool      `json:"created"`
	VerifiedAt time.Time `json:"verified_at"`
}

// Manager serializes per-account backend preparation, idempotency and audit.
type Manager struct {
	db      *sql.DB
	master  cloudcrypto.MasterKey
	drivers map[string]Driver
}

func NewManager(db *sql.DB, master cloudcrypto.MasterKey, drivers map[string]Driver) *Manager {
	if drivers == nil {
		drivers = map[string]Driver{"aws": AWSDriver{}, "azure": unonboarded{}, "gcp": unonboarded{}}
	}
	return &Manager{db: db, master: master, drivers: drivers}
}

func validRequest(r *Request) bool {
	r.Provider = strings.ToLower(strings.TrimSpace(r.Provider))
	if r.Provider != "aws" && r.Provider != "azure" && r.Provider != "gcp" {
		return false
	}
	c := &r.Context
	for _, id := range []*string{&c.WorkspaceID, &c.UserID, &c.CorrelationID} {
		parsed, err := uuid.Parse(*id)
		if err != nil || parsed == uuid.Nil {
			return false
		}
		*id = parsed.String()
	}
	if strings.TrimSpace(c.IdempotencyKey) == "" || len(c.IdempotencyKey) > 255 {
		return false
	}
	for _, p := range c.Permissions {
		if p == "iac:write" {
			return true
		}
	}
	return false
}

// Ensure verifies the remote backend, creating it on first run.
func (m *Manager) Ensure(ctx context.Context, input Request) (*Result, error) {
	result, _, err := m.ensure(ctx, input, "")
	return result, err
}

// Prepare is BE-D09's entry point before `terraform init`: it ensures the
// backend and returns credential-free -backend-config values scoped to runID.
// There is no local-state fallback; any failure must stop execution. Use one
// idempotency key per execution attempt so each attempt re-verifies access.
func (m *Manager) Prepare(ctx context.Context, input Request, runID string) (map[string]string, error) {
	run, err := uuid.Parse(runID)
	if err != nil || run == uuid.Nil {
		return nil, &Failure{Status: 400, Code: "invalid_request", Message: "Valid run ID required"}
	}
	result, settings, err := m.ensure(ctx, input, run.String())
	if err != nil {
		return nil, err
	}
	values, err := InitConfig(result.Provider, settings, input.Context.WorkspaceID, run.String())
	if err != nil {
		return nil, errUnavailable
	}
	return values, nil
}

type account struct {
	id, status, encrypted string
}

func (m *Manager) ensure(ctx context.Context, input Request, runID string) (*Result, Settings, error) {
	if !validRequest(&input) {
		return nil, Settings{}, &Failure{Status: 400, Code: "invalid_request", Message: "Valid provider and complete idempotent context required"}
	}
	c := input.Context
	started := time.Now()
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, Settings{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var role string
	err = tx.QueryRowContext(ctx, `SELECT m.role::text FROM provisr_identity.memberships m
	 JOIN provisr_identity.workspaces w ON w.id=m.workspace_id
	 WHERE m.workspace_id=$1 AND m.user_id=$2 AND w.deleted_at IS NULL FOR SHARE OF m,w`, c.WorkspaceID, c.UserID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && role != "admin" && role != "engineer") {
		return nil, Settings{}, &Failure{Status: 403, Code: "forbidden", Message: "Provisioning permission required"}
	}
	if err != nil {
		return nil, Settings{}, err
	}
	if runID != "" {
		var exists bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM provisr_state.provisioning_runs WHERE id=$1 AND workspace_id=$2)`, runID, c.WorkspaceID).Scan(&exists); err != nil {
			return nil, Settings{}, err
		}
		if !exists {
			return nil, Settings{}, &Failure{Status: 404, Code: "not_found", Message: "Run not found in workspace"}
		}
	}
	// FOR SHARE blocks a concurrent disconnect/delete until this attempt finishes.
	var a account
	err = tx.QueryRowContext(ctx, `SELECT id,status::text,metadata_encrypted FROM provisr_cloud.cloud_accounts
	 WHERE workspace_id=$1 AND provider=$2::provisr_cloud.provider FOR SHARE`, c.WorkspaceID, input.Provider).Scan(&a.id, &a.status, &a.encrypted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && a.status != "active") {
		return nil, Settings{}, &Failure{Status: 404, Code: "cloud_account_not_active", Message: "No active cloud account for this provider"}
	}
	if err != nil {
		return nil, Settings{}, err
	}
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('provisr_iac.state_backend'),hashtext($1))`, a.id); err != nil {
		return nil, Settings{}, err
	}
	var backendID string
	var existing Settings
	var raw []byte
	err = tx.QueryRowContext(ctx, `SELECT id,settings FROM provisr_iac.state_backends WHERE cloud_account_id=$1 FOR UPDATE`, a.id).Scan(&backendID, &raw)
	switch {
	case err == nil:
		if err = json.Unmarshal(raw, &existing); err != nil {
			return nil, Settings{}, err
		}
		var replay []byte
		err = tx.QueryRowContext(ctx, `SELECT response FROM provisr_iac.state_backend_requests WHERE state_backend_id=$1 AND idempotency_key=$2`, backendID, c.IdempotencyKey).Scan(&replay)
		if err == nil {
			var result Result
			if err = json.Unmarshal(replay, &result); err != nil {
				return nil, Settings{}, err
			}
			return &result, existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, Settings{}, err
		}
	case errors.Is(err, sql.ErrNoRows):
		backendID = uuid.NewString()
	default:
		return nil, Settings{}, err
	}
	driver := m.drivers[input.Provider]
	if driver == nil {
		return nil, Settings{}, errNotOnboard
	}
	target := Target{WorkspaceID: c.WorkspaceID, Existing: existing,
		Account: cloudaccount.CapabilityAccount{ID: a.id, WorkspaceID: c.WorkspaceID, Provider: input.Provider, Status: a.status}}
	if a.encrypted != "" {
		if err = cloudaccount.DecryptIdentity(m.master, a.encrypted, &target.Account); err != nil {
			return nil, Settings{}, errUnavailable
		}
	}
	outcome, err := driver.Ensure(ctx, target)
	if err != nil {
		_ = tx.Rollback()
		m.recordFailure(ctx, input, a.id, backendID, started, err)
		return nil, Settings{}, err
	}
	settings, err := json.Marshal(outcome.Settings)
	if err != nil {
		return nil, Settings{}, err
	}
	var verified time.Time
	err = tx.QueryRowContext(ctx, `INSERT INTO provisr_iac.state_backends (id,workspace_id,cloud_account_id,provider,status,settings,verified_at)
	 VALUES ($1,$2,$3,$4::provisr_cloud.provider,'ready',$5::jsonb,now())
	 ON CONFLICT (cloud_account_id) DO UPDATE SET status='ready',settings=EXCLUDED.settings,last_error_code=NULL,verified_at=now(),updated_at=now()
	 RETURNING verified_at`, backendID, c.WorkspaceID, a.id, input.Provider, string(settings)).Scan(&verified)
	if err != nil {
		return nil, Settings{}, err
	}
	result := &Result{ID: backendID, Provider: input.Provider, Status: "ready", Created: outcome.Created, VerifiedAt: verified.UTC()}
	response, err := json.Marshal(result)
	if err != nil {
		return nil, Settings{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO provisr_iac.state_backend_requests (state_backend_id,idempotency_key,response) VALUES ($1,$2,$3::jsonb)`,
		backendID, c.IdempotencyKey, string(response)); err != nil {
		return nil, Settings{}, err
	}
	event := "state_backend_verified"
	if outcome.Created {
		event = "state_backend_provisioned"
	}
	if err = appendAudit(ctx, tx, c, event, backendID, map[string]any{"state_backend_id": backendID, "cloud_account_id": a.id,
		"provider": input.Provider, "created": outcome.Created, "repaired": outcome.Repaired, "user_id": c.UserID}); err != nil {
		return nil, Settings{}, err
	}
	if err = tx.Commit(); err != nil {
		return nil, Settings{}, err
	}
	return result, outcome.Settings, nil
}

// recordFailure persists a failed attempt with its audit event. It never
// overwrites a ready record committed by a newer concurrent attempt.
func (m *Manager) recordFailure(ctx context.Context, input Request, accountID, backendID string, started time.Time, cause error) {
	code := "backend_unavailable"
	var failure *Failure
	if errors.As(cause, &failure) {
		code = failure.Code
	}
	if code == errNotOnboard.Code {
		return
	}
	// A cancelled or timed-out attempt must still leave its failure on record.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	c := input.Context
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('provisr_iac.state_backend'),hashtext($1))`, accountID); err != nil {
		return
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO provisr_iac.state_backends (id,workspace_id,cloud_account_id,provider,status,last_error_code)
	 SELECT $1,$2,id,provider,'failed',$4 FROM provisr_cloud.cloud_accounts WHERE id=$3
	 ON CONFLICT (cloud_account_id) DO UPDATE SET status='failed',last_error_code=EXCLUDED.last_error_code,updated_at=now()
	 WHERE provisr_iac.state_backends.updated_at < $5`, backendID, c.WorkspaceID, accountID, code, started)
	if err != nil {
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return
	}
	var id string
	if tx.QueryRowContext(ctx, `SELECT id FROM provisr_iac.state_backends WHERE cloud_account_id=$1`, accountID).Scan(&id) != nil {
		return
	}
	if appendAudit(ctx, tx, c, "state_backend_failed", id, map[string]any{"state_backend_id": id, "cloud_account_id": accountID,
		"provider": input.Provider, "error_code": code, "user_id": c.UserID}) != nil {
		return
	}
	_ = tx.Commit()
}

func appendAudit(ctx context.Context, tx *sql.Tx, c Context, event, resourceID string, fields map[string]any) error {
	payload, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('provisr_audit.chain'),0)`); err != nil {
		return err
	}
	var previous sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT hash FROM provisr_audit.audit_events ORDER BY seq DESC LIMIT 1`).Scan(&previous)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	// Match OR-M01's canonical sorted JSON and globally serialized chain format.
	sum := sha256.Sum256([]byte(previous.String + "|" + c.WorkspaceID + "|" + event + "|" + resourceID + "|" + string(payload) + "|" + c.CorrelationID))
	var prev any
	if previous.Valid {
		prev = previous.String
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO provisr_audit.audit_events
	 (workspace_id,event_type,actor_id,actor_type,resource_type,resource_id,payload,hash,previous_hash,correlation_id)
	 VALUES ($1,$2::provisr_audit.event_type,'provisioning-service','system','state_backend',$3,$4::jsonb,$5,$6,$7)`,
		c.WorkspaceID, event, resourceID, string(payload), hex.EncodeToString(sum[:]), prev, c.CorrelationID)
	return err
}
