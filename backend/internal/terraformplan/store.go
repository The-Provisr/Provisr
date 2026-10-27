package terraformplan

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/provisr/backend/internal/cloudaccount"
	"github.com/provisr/backend/internal/iacartifact"
	"github.com/provisr/backend/internal/statebackend"
	"github.com/provisr/backend/pkg/cloudcrypto"
)

type Backend interface {
	Prepare(context.Context, statebackend.Request, string) (map[string]string, error)
}
type Service struct {
	db          *sql.DB
	master      cloudcrypto.MasterKey
	backend     Backend
	runner      Runner
	credentials func(context.Context, cloudaccount.CapabilityAccount) ([]string, error)
}

// Create holds the run lock through planning, persisting plan and audit together.
// Cancellation/revision cannot replace the confirmed manifest during this work.
func (s *Service) Create(ctx context.Context, input Request) (result *Result, returned error) {
	if !validRequest(&input) {
		return nil, fail(400, "invalid_request", "Invalid planning context")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	c := input.Context
	var role string
	err = tx.QueryRowContext(ctx, `SELECT m.role::text FROM provisr_identity.memberships m JOIN provisr_identity.workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND w.deleted_at IS NULL FOR SHARE OF m,w`, c.WorkspaceID, c.UserID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && role != "admin" && role != "engineer") {
		return nil, fail(403, "forbidden", "Provisioning permission required")
	}
	if err != nil {
		return nil, err
	}
	var session, correlation, requester, state string
	var active, validated, confirmed sql.NullInt64
	var confirmedAt sql.NullTime
	var selected sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT session_id,correlation_id,requester_id,state,manifest_version,manifest_validated_version,manifest_confirmed_version,manifest_confirmed_at,iac_artifact_id FROM provisr_state.provisioning_runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, c.RequestID, c.WorkspaceID).Scan(&session, &correlation, &requester, &state, &active, &validated, &confirmed, &confirmedAt, &selected)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fail(404, "not_found", "IaC artifact not found in run")
	}
	if err != nil {
		return nil, err
	}
	var data []byte
	var storedHash, manifestID string
	var version int
	var provider, region string
	err = tx.QueryRowContext(ctx, `SELECT a.generation,a.hash,a.manifest_id,m.version,m.content->>'provider',m.content->>'region' FROM provisr_iac.artifacts a JOIN provisr_manifest.manifests m ON m.id=a.manifest_id AND m.run_id=a.run_id WHERE a.id=$1 AND a.run_id=$2 AND a.type='terraform'`, input.ArtifactID, c.RequestID).Scan(&data, &storedHash, &manifestID, &version, &provider, &region)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fail(404, "not_found", "IaC artifact not found in run")
	}
	if err != nil {
		return nil, err
	}
	if session != c.SessionID || correlation != c.CorrelationID || requester != c.UserID || !selected.Valid || selected.String != input.ArtifactID || !active.Valid || !validated.Valid || !confirmed.Valid || !confirmedAt.Valid || active.Int64 != int64(version) || validated.Int64 != int64(version) || confirmed.Int64 != int64(version) {
		return nil, fail(409, "manifest_not_confirmed", "Selected IaC artifact must match the current validated and confirmed manifest")
	}
	var a iacartifact.Artifact
	if json.Unmarshal(data, &a) != nil || a.ID != input.ArtifactID || a.RunID != c.RequestID || a.WorkspaceID != c.WorkspaceID || a.SessionID != c.SessionID || a.ManifestID != manifestID || a.ManifestVersion != version || a.Hash != storedHash {
		return nil, fail(422, "invalid_artifact", "Stored artifact provenance is invalid")
	}
	var replay []byte
	var original string
	err = tx.QueryRowContext(ctx, `SELECT iac_artifact_id,response FROM provisr_iac.plans WHERE run_id=$1 AND idempotency_key=$2`, c.RequestID, c.IdempotencyKey).Scan(&original, &replay)
	if err == nil {
		if original != input.ArtifactID {
			return nil, fail(409, "idempotency_conflict", "Idempotency key already used for another artifact")
		}
		var r Result
		if err = json.Unmarshal(replay, &r); err != nil {
			return nil, err
		}
		return &r, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if state != "PLAN_CREATING" {
		return nil, fail(409, "invalid_run_state", "Run must be in PLAN_CREATING before planning")
	}
	if provider != "aws" {
		return nil, fail(422, "provider_not_onboarded", "Delegated planning is available for AWS only")
	}
	// New attempts after this authorization boundary leave safe failure evidence.
	defer func() {
		if returned != nil {
			_ = tx.Rollback()
			auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			ft, err := s.db.BeginTx(auditCtx, nil)
			if err != nil {
				return
			}
			defer func() { _ = ft.Rollback() }()
			code := "plan_unavailable"
			var f *Failure
			if errors.As(returned, &f) {
				code = f.Code
			}
			if audit(auditCtx, ft, input, "error", c.RequestID, map[string]any{"operation": "terraform_plan", "run_id": c.RequestID, "iac_artifact_id": input.ArtifactID, "error_code": code}) == nil {
				_ = ft.Commit()
			}
		}
	}()
	var account cloudaccount.CapabilityAccount
	var encrypted string
	err = tx.QueryRowContext(ctx, `SELECT id,metadata_encrypted FROM provisr_cloud.cloud_accounts WHERE workspace_id=$1 AND provider='aws' AND status='active' AND verified_at IS NOT NULL FOR SHARE`, c.WorkspaceID).Scan(&account.ID, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fail(409, "cloud_account_not_active", "Verified active cloud account required")
	}
	if err != nil {
		return nil, err
	}
	account.WorkspaceID = c.WorkspaceID
	account.Provider = provider
	account.DefaultRegion = region
	if cloudaccount.DecryptIdentity(s.master, encrypted, &account) != nil {
		return nil, fail(503, "credentials_unavailable", "Delegated planning credentials unavailable")
	}
	credentials, err := s.credentials(ctx, account)
	if err != nil {
		return nil, fail(503, "credentials_unavailable", "Delegated planning credentials unavailable")
	}
	backendKey := sha256.Sum256([]byte("plan:" + input.ArtifactID + ":" + c.IdempotencyKey))
	backend, err := s.backend.Prepare(ctx, statebackend.Request{Provider: provider, Context: statebackend.Context{WorkspaceID: c.WorkspaceID, UserID: c.UserID, CorrelationID: c.CorrelationID, IdempotencyKey: "plan:" + hex.EncodeToString(backendKey[:]), Permissions: c.Permissions}}, c.RequestID)
	if err != nil {
		return nil, fail(503, "backend_unavailable", "Controlled remote backend unavailable")
	}
	output, err := s.runner.Plan(ctx, &a, backend, credentials)
	if err != nil {
		return nil, err
	}
	summary, safe, err := Normalize(output.JSON)
	if err != nil {
		return nil, fail(422, "invalid_plan", "Terraform returned an invalid plan document")
	}
	if len(output.Binary) == 0 || len(output.Binary) > 16<<20 {
		return nil, fail(422, "invalid_plan", "Generated plan exceeds size limits")
	}
	id := uuid.NewString()
	sum := sha256.New()
	_, _ = sum.Write(output.Binary)
	_, _ = sum.Write(safe)
	r := &Result{ID: id, ArtifactID: input.ArtifactID, ManifestID: manifestID, ManifestVersion: version, RunID: c.RequestID, WorkspaceID: c.WorkspaceID, SessionID: c.SessionID, Hash: hex.EncodeToString(sum.Sum(nil)), RawPlanReference: "db://provisr_iac/plans/" + id + "/json", Summary: summary}
	// Binary plans and show JSON may contain secrets. Encrypt both with an
	// independent workspace/domain key; no download route is exposed here.
	key, err := cloudcrypto.DeriveWorkspaceKey(s.master, c.WorkspaceID+"/terraform-plan/v1")
	if err != nil {
		return nil, err
	}
	ciphertext, err := cloudcrypto.EncryptJSON(key, map[string]any{"plan_artifact_id": id, "workspace_id": c.WorkspaceID, "run_id": c.RequestID, "binary_plan": output.Binary, "raw_plan_json": json.RawMessage(output.JSON), "safe_plan_json": safe})
	if err != nil {
		return nil, err
	}
	response, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO provisr_iac.artifacts(id,run_id,type,storage_path,hash) VALUES($1,$2,'plan',$3,$4)`, id, c.RequestID, "db://provisr_iac/plans/"+id, r.Hash)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO provisr_iac.plans(artifact_id,run_id,workspace_id,iac_artifact_id,manifest_id,manifest_version,idempotency_key,response,encrypted_plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, id, c.RequestID, c.WorkspaceID, input.ArtifactID, manifestID, version, c.IdempotencyKey, string(response), ciphertext)
	if err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, input, "artifact_generated", id, map[string]any{"artifact_id": id, "artifact_type": "plan", "iac_artifact_id": input.ArtifactID, "manifest_id": manifestID, "manifest_version": version, "run_id": c.RequestID, "hash": r.Hash}); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return r, nil
}

func audit(ctx context.Context, tx *sql.Tx, input Request, event, id string, fields map[string]any) error {
	c := input.Context
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
	sum := sha256.Sum256([]byte(previous.String + "|" + c.WorkspaceID + "|" + event + "|" + id + "|" + string(payload) + "|" + c.CorrelationID))
	var prev any
	if previous.Valid {
		prev = previous.String
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO provisr_audit.audit_events(workspace_id,event_type,actor_id,actor_type,resource_type,resource_id,payload,hash,previous_hash,correlation_id) VALUES($1,$2::provisr_audit.event_type,'provisioning-service','system','plan_artifact',$3,$4::jsonb,$5,$6,$7)`, c.WorkspaceID, event, id, string(payload), hex.EncodeToString(sum[:]), prev, c.CorrelationID)
	return err
}
