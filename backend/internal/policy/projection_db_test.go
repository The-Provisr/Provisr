package policy

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

// Seeded by migration 000015: the compliance pack holding the allowed_regions rule.
const compliancePackID = "a0000000-0000-0000-0000-000000000003"

func projectionDatabase(t *testing.T) *sql.DB {
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
	t.Cleanup(func() { db.Close() })
	return db
}

func TestProjectAllowedRegionsPostgres(t *testing.T) {
	db := projectionDatabase(t)
	ctx := context.Background()
	workspaceID := uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO provisr_identity.workspaces (id, name, slug, environment)
      VALUES ($1, 'projection', $2, 'dev')`, workspaceID, "projection-"+workspaceID); err != nil {
		t.Fatal(err)
	}
	setRegions := func(params string) {
		t.Helper()
		if _, err := db.ExecContext(ctx, `UPDATE provisr_policy.policy_rules SET parameters_schema = $1::jsonb, is_enabled = true
          WHERE pack_id = $2 AND rule_key = 'allowed_regions'`, params, compliancePackID); err != nil {
			t.Fatal(err)
		}
	}
	project := func() *[]string {
		t.Helper()
		reqs, err := ProjectPolicyRequirements(ctx, db, workspaceID)
		if err != nil {
			t.Fatal(err)
		}
		return reqs.AllowedRegions
	}

	// No pack enabled: the rule is not in force, so the field is absent.
	if _, err := db.ExecContext(ctx, `INSERT INTO provisr_policy.workspace_policy_settings (workspace_id, enabled_pack_ids)
      VALUES ($1, '{}')`, workspaceID); err != nil {
		t.Fatal(err)
	}
	if regions := project(); regions != nil {
		t.Fatalf("expected no allowed_regions without an enabled rule, got %v", *regions)
	}

	if _, err := db.ExecContext(ctx, `UPDATE provisr_policy.workspace_policy_settings SET enabled_pack_ids = ARRAY[$2::uuid]
      WHERE workspace_id = $1`, workspaceID, compliancePackID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { setRegions(`{"regions": ["us-east-1", "us-west-2", "eu-west-1"]}`) })

	// Enabled with zero regions (only reachable by direct writes): present and empty.
	setRegions(`{"regions": []}`)
	if regions := project(); regions == nil || len(*regions) != 0 {
		t.Fatalf("expected an empty allowed_regions list, got %v", regions)
	}

	setRegions(`{"regions": ["us-west-2", "us-east-1"]}`)
	if regions := project(); regions == nil || strings.Join(*regions, ",") != "us-east-1,us-west-2" {
		t.Fatalf("expected sorted allowed regions, got %v", regions)
	}
}
