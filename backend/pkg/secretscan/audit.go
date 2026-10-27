package secretscan

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
)

// Audit actions recorded with findings.
const (
	ActionBlocked  = "blocked"
	ActionRedacted = "redacted"
)

// AuditInput describes where findings were detected. Findings carry type and
// location only, so the event never contains secret values.
type AuditInput struct {
	WorkspaceID   string
	CorrelationID string
	ActorID       string // emitting service, e.g. "manifest-service"
	ResourceType  string
	ResourceID    string
	ArtifactKind  string // terraform, manifest, plan, log
	Action        string
	Findings      []Finding
}

// RecordFindings appends a secret_detected event to the hash-chained audit log
// in tx, using the same canonical chain format as the other backend writers.
func RecordFindings(ctx context.Context, tx *sql.Tx, in AuditInput) error {
	findings := make([]map[string]string, 0, len(in.Findings))
	for _, f := range in.Findings {
		findings = append(findings, map[string]string{"type": f.Type, "location": f.Location, "detector": f.Detector})
	}
	payload, err := json.Marshal(map[string]any{"artifact_kind": in.ArtifactKind, "action": in.Action,
		"finding_count": len(in.Findings), "findings": findings})
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
	sum := sha256.Sum256([]byte(previous.String + "|" + in.WorkspaceID + "|secret_detected|" + in.ResourceID + "|" + string(payload) + "|" + in.CorrelationID))
	var prev any
	if previous.Valid {
		prev = previous.String
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO provisr_audit.audit_events
	 (workspace_id,event_type,actor_id,actor_type,resource_type,resource_id,payload,hash,previous_hash,correlation_id)
	 VALUES ($1,'secret_detected',$2,'system',$3,$4,$5::jsonb,$6,$7,$8)`, in.WorkspaceID, in.ActorID, in.ResourceType,
		in.ResourceID, string(payload), hex.EncodeToString(sum[:]), prev, in.CorrelationID)
	return err
}
