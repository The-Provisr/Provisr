package db

import (
	"context"
	"testing"
)

// TestAuditWriterRole_InsertAllowed proves the audit_writer role
// can INSERT into provisr_audit.audit_events.
func TestAuditWriterRole_InsertAllowed(t *testing.T) {
	cfg := Config{
		Host:     "localhost",
		Port:     5433,
		Name:     "provisr",
		User:     "audit_writer",
		Password: "audit_writer_secret",
		SSLMode:  "disable",
	}

	pool, err := NewPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("failed to connect as audit_writer: %v", err)
	}
	defer pool.Close()

	var eventID string
	err = pool.QueryRow(context.Background(),
		`INSERT INTO provisr_audit.audit_events (
			org_id, event_type, event_severity, actor_type,
			action, outcome, source_service, event_hash
		) VALUES (
			gen_random_uuid(), 'STATE_TRANSITION', 'INFO', 'system',
			'transition', 'success', 'audit_test', repeat('0', 64)
		) RETURNING event_id`,
	).Scan(&eventID)

	if err != nil {
		t.Fatalf("INSERT should succeed for audit_writer, got: %v", err)
	}

	if eventID == "" {
		t.Fatal("expected non-empty event_id")
	}

	t.Logf("audit_writer INSERT succeeded: event_id=%s", eventID)
}

// TestAuditWriterRole_UpdateRejected proves the audit_writer role
// cannot UPDATE rows in provisr_audit.audit_events.
func TestAuditWriterRole_UpdateRejected(t *testing.T) {
	cfg := Config{
		Host:     "localhost",
		Port:     5433,
		Name:     "provisr",
		User:     "audit_writer",
		Password: "audit_writer_secret",
		SSLMode:  "disable",
	}

	pool, err := NewPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("failed to connect as audit_writer: %v", err)
	}
	defer pool.Close()

	_, err = pool.Exec(context.Background(),
		`UPDATE provisr_audit.audit_events SET action = 'hacked'`,
	)

	if err == nil {
		t.Fatal("UPDATE should be denied for audit_writer, but it succeeded")
	}

	t.Logf("audit_writer UPDATE correctly rejected: %v", err)
}

// TestAuditWriterRole_DeleteRejected proves the audit_writer role
// cannot DELETE rows from provisr_audit.audit_events.
func TestAuditWriterRole_DeleteRejected(t *testing.T) {
	cfg := Config{
		Host:     "localhost",
		Port:     5433,
		Name:     "provisr",
		User:     "audit_writer",
		Password: "audit_writer_secret",
		SSLMode:  "disable",
	}

	pool, err := NewPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("failed to connect as audit_writer: %v", err)
	}
	defer pool.Close()

	_, err = pool.Exec(context.Background(),
		`DELETE FROM provisr_audit.audit_events`,
	)

	if err == nil {
		t.Fatal("DELETE should be denied for audit_writer, but it succeeded")
	}

	t.Logf("audit_writer DELETE correctly rejected: %v", err)
}
