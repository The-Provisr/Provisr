package iacartifact

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/provisr/backend/internal/manifest"
	"github.com/provisr/backend/internal/terraform"
)

type DBGenerator struct{ db *sql.DB }

type runLock struct {
	Session, Correlation, Requester, State string
	Version, Active, Validated, Confirmed  sql.NullInt64
	ConfirmedAt                            sql.NullTime
}

func (run runLock) matches(r Request, version int) bool {
	c := r.Context
	return run.Session == c.SessionID && run.Correlation == c.CorrelationID &&
		run.Requester == c.UserID && run.Active.Valid && run.Validated.Valid &&
		run.Confirmed.Valid && run.ConfirmedAt.Valid && run.Active.Int64 == int64(version) &&
		run.Validated.Int64 == int64(version) && run.Confirmed.Int64 == int64(version)
}

// Generate serializes authorization, run selection, storage and audit in one
// transaction. Callers cannot supply manifest content or confirmation claims.
func (s *DBGenerator) Generate(ctx context.Context, input Request) (*Artifact, error) {
	if !validRequest(input) {
		return nil, &Failure{Status: 400, Code: "invalid_request", Message: "Invalid generation context"}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	c := input.Context
	var role string
	err = tx.QueryRowContext(ctx, `SELECT m.role::text FROM provisr_identity.memberships m
	 JOIN provisr_identity.workspaces w ON w.id=m.workspace_id
	 WHERE m.workspace_id=$1 AND m.user_id=$2 AND w.deleted_at IS NULL FOR SHARE OF m,w`, c.WorkspaceID, c.UserID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && role != "admin" && role != "engineer") {
		return nil, &Failure{Status: 403, Code: "forbidden", Message: "Provisioning permission required"}
	}
	if err != nil {
		return nil, err
	}
	var run runLock
	err = tx.QueryRowContext(ctx, `SELECT session_id,correlation_id,requester_id,state,state_version,
	 manifest_version,manifest_validated_version,manifest_confirmed_version,manifest_confirmed_at
	 FROM provisr_state.provisioning_runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, c.RequestID, c.WorkspaceID).
		Scan(&run.Session, &run.Correlation, &run.Requester, &run.State, &run.Version, &run.Active, &run.Validated, &run.Confirmed, &run.ConfirmedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &Failure{Status: 404, Code: "not_found", Message: "Manifest not found in run"}
	}
	if err != nil {
		return nil, err
	}
	var content []byte
	var version int
	err = tx.QueryRowContext(ctx, `SELECT content,version FROM provisr_manifest.manifests WHERE id=$1 AND run_id=$2`, input.ManifestID, c.RequestID).Scan(&content, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &Failure{Status: 404, Code: "not_found", Message: "Manifest not found in run"}
	}
	if err != nil {
		return nil, err
	}
	if !run.matches(input, version) {
		return nil, &Failure{Status: 409, Code: "manifest_not_confirmed", Message: "Selected manifest must be validated and confirmed for this run context"}
	}
	var existing []byte
	var existingManifest string
	err = tx.QueryRowContext(ctx, `SELECT manifest_id,generation FROM provisr_iac.artifacts
	 WHERE run_id=$1 AND idempotency_key=$2`, c.RequestID, c.IdempotencyKey).Scan(&existingManifest, &existing)
	if err == nil {
		if existingManifest != input.ManifestID {
			return nil, &Failure{Status: 409, Code: "idempotency_conflict", Message: "Idempotency key already used for another manifest"}
		}
		var artifact Artifact
		if err = json.Unmarshal(existing, &artifact); err != nil {
			return nil, err
		}
		return &artifact, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if run.State != "IAC_GENERATING" {
		return nil, &Failure{Status: 409, Code: "invalid_run_state", Message: "Run must be in IAC_GENERATING before generation"}
	}
	// Require the original key when replaying this immutable version. Silently
	// accepting a new key would fail to bind that key against future reuse.
	err = tx.QueryRowContext(ctx, `SELECT generation FROM provisr_iac.artifacts WHERE run_id=$1 AND manifest_id=$2 AND type='terraform'`, c.RequestID, input.ManifestID).Scan(&existing)
	if err == nil {
		return nil, &Failure{Status: 409, Code: "artifact_exists", Message: "Artifact already generated; retry with the original idempotency key"}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var m manifest.Manifest
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.UseNumber()
	if err = decoder.Decode(&m); err != nil {
		return nil, &Failure{Status: 422, Code: "invalid_manifest", Message: "Stored manifest is invalid"}
	}
	bundle, err := terraform.Bundle(&m)
	if err != nil {
		return nil, &Failure{Status: 422, Code: "invalid_manifest", Message: "Manifest cannot be rendered by reviewed templates"}
	}
	if len(bundle.Unsupported) > 0 {
		return nil, &Failure{Status: 422, Code: "unsupported", Message: "Manifest includes unsupported resource types", Unsupported: bundle.Unsupported}
	}
	a := &Artifact{ID: uuid.NewString(), ManifestID: input.ManifestID, ManifestVersion: version,
		RunID: c.RequestID, WorkspaceID: c.WorkspaceID, SessionID: c.SessionID, Files: bundle.Files,
		FileList: []string{}, FileCount: len(bundle.Files), TemplateSource: "template",
		Summary: Summary{ResourceCount: len(m.Resources), FileCount: len(bundle.Files)}}
	hash := sha256.New()
	for _, file := range a.Files {
		a.FileList = append(a.FileList, file.Path)
		a.TotalSize += len([]byte(file.Content))
		// Explicit separators make hashes reproducible across Go/Python encoders.
		_, _ = hash.Write([]byte(file.Path + "\x00" + file.Content + "\x00"))
	}
	if a.TotalSize > 4<<20 || a.Summary.ResourceCount > 1000 {
		return nil, &Failure{Status: 422, Code: "artifact_too_large", Message: "Manifest exceeds Terraform artifact size limits"}
	}
	a.Hash = hex.EncodeToString(hash.Sum(nil))
	data, err := json.Marshal(a)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO provisr_iac.artifacts
	 (id,run_id,type,storage_path,hash,manifest_id,idempotency_key,generation)
	 VALUES ($1,$2,'terraform',$3,$4,$5,$6,$7::jsonb)`, a.ID, a.RunID, "db://provisr_iac/artifacts/"+a.ID, a.Hash, a.ManifestID, c.IdempotencyKey, string(data))
	if err != nil {
		return nil, err
	}
	if err = appendAudit(ctx, tx, input, a); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return a, nil
}

func appendAudit(ctx context.Context, tx *sql.Tx, input Request, a *Artifact) error {
	c := input.Context
	payload, err := json.Marshal(map[string]any{"artifact_id": a.ID, "manifest_id": a.ManifestID, "manifest_version": a.ManifestVersion, "run_id": a.RunID, "hash": a.Hash, "file_count": a.FileCount, "template_source": a.TemplateSource})
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
	sum := sha256.Sum256([]byte(previous.String + "|" + c.WorkspaceID + "|artifact_generated|" + a.ID + "|" + string(payload) + "|" + c.CorrelationID))
	var prev any
	if previous.Valid {
		prev = previous.String
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO provisr_audit.audit_events
	 (workspace_id,event_type,actor_id,actor_type,resource_type,resource_id,payload,hash,previous_hash,correlation_id)
	 VALUES ($1,'artifact_generated','manifest-service','system','iac_artifact',$2,$3::jsonb,$4,$5,$6)`, c.WorkspaceID, a.ID, string(payload), hex.EncodeToString(sum[:]), prev, c.CorrelationID)
	return err
}
