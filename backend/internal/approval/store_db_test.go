package approval

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func approvalDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required for real PostgreSQL proof")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(parsed.Path, "/provisr_or_planning_test_") {
		t.Fatal("Use a disposable provisr_or_planning_test_* database")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSQLStorePostgres(t *testing.T) {
	db := approvalDatabase(t)
	ctx := context.Background()
	store := sqlStore{db: db}

	workspaceID, userID, outsiderID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO provisr_identity.workspaces (id, name, slug, environment, settings)
      VALUES ($1, 'approval', $2, 'prod', '{"approval_rules": {"cost_threshold_usd": 750}}')`,
		workspaceID, "approval-"+workspaceID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{userID, outsiderID} {
		if _, err := db.ExecContext(ctx, `INSERT INTO provisr_identity.users (id, clerk_id, name, email)
          VALUES ($1, $2, 'approval test', 'approval@example.test')`, id, "clerk-"+id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO provisr_identity.memberships (user_id, workspace_id, role)
      VALUES ($1, $2, 'engineer')`, userID, workspaceID); err != nil {
		t.Fatal(err)
	}

	got, err := store.LoadEvaluationContext(ctx, workspaceID, userID)
	if err != nil {
		t.Fatal(err)
	}
	if got.WorkspaceEnvironment != "prod" || got.UserRole != "engineer" || got.Config.CostThresholdUSD != 750 {
		t.Fatalf("unexpected context: %+v", got)
	}
	if _, err := store.LoadEvaluationContext(ctx, workspaceID, outsiderID); !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember for non-member, got %v", err)
	}

	rec := AuditRecord{WorkspaceID: workspaceID, ResourceID: uuid.NewString(), EvaluationID: uuid.NewString(),
		Payload: map[string]any{"input_digest": "abc", "requires_approval": true}}
	for range 2 {
		if err := store.RecordEvaluation(ctx, rec); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := db.QueryContext(ctx, `SELECT hash, previous_hash, payload FROM provisr_audit.audit_events
      WHERE workspace_id = $1 AND event_type = 'approval_requirements_evaluated' ORDER BY seq`, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	var hashes, prevs []string
	for rows.Next() {
		var hash string
		var prev sql.NullString
		var payload []byte
		if err := rows.Scan(&hash, &prev, &payload); err != nil {
			t.Fatal(err)
		}
		var p map[string]any
		if err := json.Unmarshal(payload, &p); err != nil || p["input_digest"] != "abc" {
			t.Fatalf("payload not persisted: %s", payload)
		}
		hashes, prevs = append(hashes, hash), append(prevs, prev.String)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(hashes) != 2 || prevs[1] != hashes[0] {
		t.Fatalf("expected two chained audit events, got hashes %v prev %v", hashes, prevs)
	}
}
