package main

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestAuditEventsAppendOnlyPrivileges verifies the BE-A03 review fix: the
// workspace service connects as provisr_app, a least-privilege role that can
// append and read audit events but must never UPDATE or DELETE them. The
// privilege policy (migration 000017) is checked directly, and a functional
// check confirms an UPDATE attempt fails at the database layer.
func TestAuditEventsAppendOnlyPrivileges(t *testing.T) {
	db := setupTestDB(t)

	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("acquire connection: %v", err)
	}
	defer conn.Close()
	ctx := context.Background()

	if _, err := conn.ExecContext(ctx, "SET ROLE provisr_app"); err != nil {
		t.Skipf("cannot assume provisr_app role (superuser required): %v", err)
	}
	defer conn.ExecContext(ctx, "RESET ROLE")

	if has, err := tablePrivilege(ctx, conn, "SELECT"); err != nil {
		t.Fatalf("check SELECT privilege: %v", err)
	} else if !has {
		t.Error("provisr_app must be able to SELECT audit_events")
	}
	if has, err := tablePrivilege(ctx, conn, "INSERT"); err != nil {
		t.Fatalf("check INSERT privilege: %v", err)
	} else if !has {
		t.Error("provisr_app must be able to INSERT audit_events")
	}
	if has, err := tablePrivilege(ctx, conn, "UPDATE"); err != nil {
		t.Fatalf("check UPDATE privilege: %v", err)
	} else if has {
		t.Error("provisr_app must NOT be able to UPDATE audit_events")
	}
	if has, err := tablePrivilege(ctx, conn, "DELETE"); err != nil {
		t.Fatalf("check DELETE privilege: %v", err)
	} else if has {
		t.Error("provisr_app must NOT be able to DELETE audit_events")
	}
	if has, err := tablePrivilege(ctx, conn, "TRUNCATE"); err != nil {
		t.Fatalf("check TRUNCATE privilege: %v", err)
	} else if has {
		t.Error("provisr_app must NOT be able to TRUNCATE audit_events")
	}

	workspaceID := uuid.NewString()
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO provisr_identity.workspaces (id, name, slug, environment)
		 VALUES ($1, $2, $3, 'dev')`,
		workspaceID, "audit-privilege-test", "audit-privilege-test",
	); err != nil {
		t.Fatalf("seed workspace as provisr_app: %v", err)
	}

	if _, err := conn.ExecContext(ctx,
		`INSERT INTO provisr_audit.audit_events
		   (workspace_id, event_type, actor_id, actor_type, resource_type, resource_id,
		    payload, hash, correlation_id)
		 VALUES ($1, 'workspace_created', 'system', 'system', 'workspace', $2,
		         '{}', $3, $4)`,
		workspaceID, workspaceID, strings.Repeat("0", 64), uuid.NewString(),
	); err != nil {
		t.Fatalf("append audit event as provisr_app must succeed: %v", err)
	}

	if _, err := conn.ExecContext(ctx,
		`UPDATE provisr_audit.audit_events SET payload = payload`,
	); err == nil {
		t.Fatal("UPDATE on audit_events as provisr_app must be denied")
	}

	if _, err := conn.ExecContext(ctx,
		`DELETE FROM provisr_audit.audit_events`,
	); err == nil {
		t.Fatal("DELETE on audit_events as provisr_app must be denied")
	}

	if _, err := conn.ExecContext(ctx,
		`TRUNCATE provisr_audit.audit_events`,
	); err == nil {
		t.Fatal("TRUNCATE on audit_events as provisr_app must be denied")
	}

	if _, err := conn.ExecContext(ctx, "RESET ROLE"); err != nil {
		t.Fatalf("reset role: %v", err)
	}

	// The statement-level trigger must block TRUNCATE for the table owner
	// too: row-level triggers do not fire on TRUNCATE.
	if _, err := conn.ExecContext(ctx,
		`TRUNCATE provisr_audit.audit_events`,
	); err == nil {
		t.Fatal("TRUNCATE on audit_events must be denied by the append-only trigger")
	}
}

// tablePrivilege reports whether the current role holds the given privilege
// on provisr_audit.audit_events.
func tablePrivilege(ctx context.Context, conn *sql.Conn, privilege string) (bool, error) {
	var has bool
	err := conn.QueryRowContext(ctx,
		`SELECT has_table_privilege(current_user, 'provisr_audit.audit_events', $1)`,
		privilege,
	).Scan(&has)
	return has, err
}