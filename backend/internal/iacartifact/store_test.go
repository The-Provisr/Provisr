package iacartifact

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	_ "github.com/lib/pq"
)

func database(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required for disposable PostgreSQL proof")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(u.Path, "/provisr_or_planning_test_") {
		t.Fatal("Use a disposable provisr_or_planning_test_* database")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func seed(t *testing.T, db *sql.DB) Request {
	t.Helper()
	r := request()
	c := r.Context
	exec := func(q string, args ...any) {
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO provisr_identity.users(id,clerk_id,name,email) VALUES ($1,$2,'Test','test@example.invalid')`, c.UserID, c.UserID)
	exec(`INSERT INTO provisr_identity.workspaces(id,name,slug,environment) VALUES ($1,'Test',$2,'dev')`, c.WorkspaceID, c.WorkspaceID)
	exec(`INSERT INTO provisr_identity.memberships(workspace_id,user_id,role) VALUES ($1,$2,'engineer')`, c.WorkspaceID, c.UserID)
	exec(`INSERT INTO provisr_state.chat_sessions(id,workspace_id,user_id,title) VALUES ($1,$2,$3,'Test')`, c.SessionID, c.WorkspaceID, c.UserID)
	exec(`INSERT INTO provisr_state.provisioning_runs(id,session_id,workspace_id,requester_id,prompt,idempotency_key,correlation_id,state)
	 VALUES ($1,$2,$3,$4,'Test',$6,$5,'IAC_GENERATING')`, c.RequestID, c.SessionID, c.WorkspaceID, c.UserID, c.CorrelationID, c.RequestID)
	exec(`INSERT INTO provisr_manifest.manifests(id,run_id,version,content) VALUES ($1,$2,1,$3)`, r.ManifestID, c.RequestID,
		`{"schema_version":"1.0","provider":"aws","region":"us-east-1","resources":[{"logical_name":"bucket","type":"storage.aws.s3","properties":{"name":"private-test-bucket","versioning":false}}]}`)
	exec(`UPDATE provisr_state.provisioning_runs SET manifest_version=1,manifest_validated_version=1,manifest_confirmed_version=1,manifest_confirmed_at=now() WHERE id=$1`, c.RequestID)
	return r
}

func expectCode(t *testing.T, err error, code string) {
	t.Helper()
	var f *Failure
	if !errors.As(err, &f) || f.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func TestGenerationConcurrentReplayPostgres(t *testing.T) {
	db := database(t)
	r := seed(t, db)
	s := &DBGenerator{db: db}
	ctx := context.Background()
	var wg sync.WaitGroup
	ids := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a, err := s.Generate(ctx, r)
			if err != nil {
				t.Error(err)
				return
			}
			ids <- a.ID
		}()
	}
	wg.Wait()
	close(ids)
	id := ""
	for got := range ids {
		if id != "" && got != id {
			t.Fatal("duplicate artifact")
		}
		id = got
	}
	if id == "" {
		t.Fatal("no artifact generated")
	}
	var count int
	for _, q := range []string{`SELECT count(*) FROM provisr_iac.artifacts WHERE run_id=$1`, `SELECT count(*) FROM provisr_audit.audit_events WHERE payload->>'run_id'=$1 AND event_type='artifact_generated'`} {
		if err := db.QueryRow(q, r.Context.RequestID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("count %d, err %v", count, err)
		}
	}
	if _, err := db.Exec(`UPDATE provisr_state.provisioning_runs SET state='PLAN_CREATING' WHERE id=$1`, r.Context.RequestID); err != nil {
		t.Fatal(err)
	}
	if a, err := s.Generate(ctx, r); err != nil || a.ID != id {
		t.Fatal("advanced-state replay failed", err)
	}
	if _, err := db.Exec(`UPDATE provisr_iac.artifacts SET hash=repeat('0',64) WHERE id=$1`, id); err == nil {
		t.Fatal("artifact update accepted")
	}
	if _, err := db.Exec(`DELETE FROM provisr_iac.artifacts WHERE id=$1`, id); err == nil {
		t.Fatal("artifact deletion accepted")
	}
	// A key cannot authorize generation of a newly confirmed version.
	if _, err := db.Exec(`INSERT INTO provisr_manifest.manifests(run_id,version,content) SELECT run_id,2,content FROM provisr_manifest.manifests WHERE id=$1`, r.ManifestID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT id FROM provisr_manifest.manifests WHERE run_id=$1 AND version=2`, r.Context.RequestID).Scan(&r.ManifestID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE provisr_state.provisioning_runs SET state='IAC_GENERATING',manifest_version=2,manifest_validated_version=2,manifest_confirmed_version=2 WHERE id=$1`, r.Context.RequestID); err != nil {
		t.Fatal(err)
	}
	_, err := s.Generate(ctx, r)
	expectCode(t, err, "idempotency_conflict")
}

func TestGenerationGuardsPostgres(t *testing.T) {
	db := database(t)
	s := &DBGenerator{db: db}
	ctx := context.Background()
	for _, tc := range []struct{ name, sql, code string }{
		{"unconfirmed", `UPDATE provisr_state.provisioning_runs SET manifest_confirmed_version=NULL,manifest_confirmed_at=NULL WHERE id=$1`, "manifest_not_confirmed"},
		{"not validated", `UPDATE provisr_state.provisioning_runs SET manifest_validated_version=NULL WHERE id=$1`, "manifest_not_confirmed"},
		{"wrong state", `UPDATE provisr_state.provisioning_runs SET state='MANIFEST_VALIDATING' WHERE id=$1`, "invalid_run_state"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := seed(t, db)
			if _, err := db.Exec(tc.sql, r.Context.RequestID); err != nil {
				t.Fatal(err)
			}
			_, err := s.Generate(ctx, r)
			expectCode(t, err, tc.code)
		})
	}
	for _, field := range []string{"workspace", "session", "correlation", "user", "manifest"} {
		t.Run(field, func(t *testing.T) {
			r := seed(t, db)
			other := request()
			switch field {
			case "workspace":
				r.Context.WorkspaceID = other.Context.WorkspaceID
			case "session":
				r.Context.SessionID = other.Context.SessionID
			case "correlation":
				r.Context.CorrelationID = other.Context.CorrelationID
			case "user":
				r.Context.UserID = other.Context.UserID
			case "manifest":
				r.ManifestID = other.ManifestID
			}
			if _, err := s.Generate(ctx, r); err == nil {
				t.Fatal("foreign context accepted")
			}
		})
	}
	r := seed(t, db)
	if _, err := db.Exec(`UPDATE provisr_identity.memberships SET role='viewer' WHERE workspace_id=$1`, r.Context.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	_, err := s.Generate(ctx, r)
	expectCode(t, err, "forbidden")
}

func TestAuditFailureRollsBackArtifactPostgres(t *testing.T) {
	db := database(t)
	r := seed(t, db)
	_, err := db.Exec(`CREATE FUNCTION provisr_iac.test_reject_artifact_audit() RETURNS trigger LANGUAGE plpgsql AS $$
	 BEGIN IF NEW.payload->>'run_id'='` + r.Context.RequestID + `' THEN RAISE EXCEPTION 'test rejection'; END IF; RETURN NEW; END $$;
	 CREATE TRIGGER test_reject_artifact_audit BEFORE INSERT ON provisr_audit.audit_events FOR EACH ROW EXECUTE FUNCTION provisr_iac.test_reject_artifact_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DROP TRIGGER test_reject_artifact_audit ON provisr_audit.audit_events; DROP FUNCTION provisr_iac.test_reject_artifact_audit()`)
	})
	if _, err = (&DBGenerator{db: db}).Generate(context.Background(), r); err == nil {
		t.Fatal("audit failure ignored")
	}
	var count int
	if err = db.QueryRow(`SELECT count(*) FROM provisr_iac.artifacts WHERE run_id=$1`, r.Context.RequestID).Scan(&count); err != nil || count != 0 {
		t.Fatal("artifact not rolled back", err)
	}
}

func TestStoredArtifactIntegrityPostgres(t *testing.T) {
	db := database(t)
	r := seed(t, db)
	a, err := (&DBGenerator{db: db}).Generate(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	var data []byte
	var hash string
	if err = db.QueryRow(`SELECT generation,hash FROM provisr_iac.artifacts WHERE id=$1`, a.ID).Scan(&data, &hash); err != nil {
		t.Fatal(err)
	}
	var stored Artifact
	if err = json.Unmarshal(data, &stored); err != nil || stored.Hash != hash || stored.ManifestVersion != 1 || stored.TotalSize == 0 || len(stored.Files) != stored.FileCount {
		t.Fatal("invalid persisted bundle", err)
	}
}

func TestGenerationWithApplicationRolePostgres(t *testing.T) {
	db := database(t)
	r := seed(t, db)
	u, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("options", "-c role=provisr_app")
	u.RawQuery = q.Encode()
	app, err := sql.Open("postgres", u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = app.Close() }()
	if _, err = (&DBGenerator{db: app}).Generate(context.Background(), r); err != nil {
		t.Fatal(err)
	}
}
