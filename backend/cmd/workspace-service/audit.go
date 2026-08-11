package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
)

func appendAuditEvent(
	r *http.Request,
	tx *sql.Tx,
	workspaceID string,
	eventType string,
	actorID string,
	resourceType string,
	resourceID string,
	payload map[string]any,
) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal audit payload: %w", err)
	}

	actorType := "user"
	if actorID == "" {
		actorID = "system"
		actorType = "system"
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

	correlationID := r.Header.Get("X-Correlation-ID")
	if _, err := uuid.Parse(correlationID); err != nil {
		correlationID = r.Header.Get("X-Request-ID")
	}
	if _, err := uuid.Parse(correlationID); err != nil {
		correlationID = uuid.NewString()
	}

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
		 VALUES ($1, $2::provisr_audit.event_type, $3, $4::provisr_audit.actor_type, $5, $6, $7, $8, $9, $10::uuid)`,
		workspaceID, eventType, actorID, actorType, resourceType, resourceID, payloadJSON, eventHash, prev, correlationID,
	)
	if err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return nil
}
