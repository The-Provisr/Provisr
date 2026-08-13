package main

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// Idempotency-Key support for workspace-service mutations. Mirrors the
// BE-B01 (cloud account) pattern: keys are claimed inside the mutation's
// transaction against the shared provisr_idempotency.keys table, which is
// scoped by workspace so a key from one workspace never blocks another.

var (
	errIdempotencyKeyMissing = errors.New("idempotency key missing")
	errIdempotencyKeyUsed    = errors.New("idempotency key already used")
)

// claimIdempotencyKey reserves the Idempotency-Key header for a mutation
// within the caller's transaction. A missing or oversized key is rejected
// before any state change; a key already consumed by a previous successful
// mutation is rejected so a mutation is never applied twice.
func claimIdempotencyKey(tx *sql.Tx, key, workspaceID, mutation string) error {
	key = strings.TrimSpace(key)
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
		return fmt.Errorf("claim idempotency key: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("read idempotency claim result: %w", err)
	}
	if affected == 0 {
		return errIdempotencyKeyUsed
	}
	return nil
}

func writeIdempotencyError(w http.ResponseWriter, r *http.Request, err error, s *server) {
	switch {
	case errors.Is(err, errIdempotencyKeyMissing):
		writeError(w, http.StatusBadRequest, "idempotency_key_required", "Idempotency-Key header is required for mutations")
	case errors.Is(err, errIdempotencyKeyUsed):
		writeError(w, http.StatusConflict, "duplicate_idempotency_key", "Idempotency-Key was already used for a mutation")
	default:
		s.reqLog(r).Error().Err(err).Msg("failed to claim idempotency key")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to process mutation")
	}
}
