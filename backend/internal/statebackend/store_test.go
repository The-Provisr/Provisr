package statebackend

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"

	"github.com/provisr/backend/pkg/cloudcrypto"
)

var testMaster = cloudcrypto.MasterKey(make([]byte, 32))

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

type seeded struct {
	req       Request
	accountID string
	runID     string
}

func seed(t *testing.T, db *sql.DB, provider, status string) seeded {
	t.Helper()
	ws, user, run, acct := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec := func(q string, args ...any) {
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	key, err := cloudcrypto.DeriveWorkspaceKey(testMaster, ws)
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cloudcrypto.EncryptJSON(key, map[string]any{"role_arn": "arn:aws:iam::123456789012:role/ProvisrExecutionRole", "external_id": "external-test", "default_region": "eu-west-1"})
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO provisr_identity.users(id,clerk_id,name,email) VALUES ($1,$2,'Test','test@example.invalid')`, user, user)
	exec(`INSERT INTO provisr_identity.workspaces(id,name,slug,environment) VALUES ($1,'Test',$2,'dev')`, ws, ws)
	exec(`INSERT INTO provisr_identity.memberships(workspace_id,user_id,role) VALUES ($1,$2,'engineer')`, ws, user)
	exec(`INSERT INTO provisr_cloud.cloud_accounts(id,workspace_id,provider,label,status,metadata_encrypted) VALUES ($1,$2,$3,'Test',$4,$5)`, acct, ws, provider, status, encrypted)
	exec(`INSERT INTO provisr_state.chat_sessions(id,workspace_id,user_id,title) VALUES ($1,$2,$3,'Test')`, run, ws, user)
	exec(`INSERT INTO provisr_state.provisioning_runs(id,session_id,workspace_id,requester_id,prompt,idempotency_key,correlation_id)
	 VALUES ($1,$1,$2,$3,'Test',$4,$1)`, run, ws, user, run)
	return seeded{accountID: acct, runID: run, req: Request{Provider: provider, Context: Context{WorkspaceID: ws, UserID: user,
		CorrelationID: uuid.NewString(), IdempotencyKey: "ensure-1", Permissions: []string{"iac:write"}}}}
}

// recordingDriver counts provider work and reports creation only for a first run.
type recordingDriver struct {
	mu       sync.Mutex
	calls    int
	firsts   int
	identity string
	err      error
}

func (d *recordingDriver) Ensure(_ context.Context, t Target) (Outcome, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls++
	d.identity = t.Account.RoleARN + "|" + t.Account.ExternalID
	if d.err != nil {
		return Outcome{}, d.err
	}
	created := t.Existing.Bucket == ""
	if created {
		d.firsts++
	}
	s, err := AWSSettings(t.WorkspaceID, "123456789012", t.Account.DefaultRegion)
	return Outcome{Settings: s, Created: created}, err
}

func manager(db *sql.DB, d Driver) *Manager {
	return NewManager(db, testMaster, map[string]Driver{"aws": d, "azure": unonboarded{}, "gcp": unonboarded{}})
}

func events(t *testing.T, db *sql.DB, ws string) []string {
	t.Helper()
	rows, err := db.Query(`SELECT event_type::text FROM provisr_audit.audit_events WHERE workspace_id=$1 ORDER BY seq`, ws)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	out := []string{}
	for rows.Next() {
		var e string
		_ = rows.Scan(&e)
		out = append(out, e)
	}
	return out
}

func TestEnsureProvisionsReplaysAndReverifiesPostgres(t *testing.T) {
	db := database(t)
	s := seed(t, db, "aws", "active")
	d := &recordingDriver{}
	m := manager(db, d)
	first, err := m.Ensure(context.Background(), s.req)
	if err != nil || !first.Created || first.Status != "ready" {
		t.Fatalf("first ensure: %+v %v", first, err)
	}
	if d.identity != "arn:aws:iam::123456789012:role/ProvisrExecutionRole|external-test" {
		t.Fatal("driver did not receive decrypted delegated identity")
	}
	replay, err := m.Ensure(context.Background(), s.req)
	if err != nil || d.calls != 1 || replay.ID != first.ID || !replay.VerifiedAt.Equal(first.VerifiedAt) {
		t.Fatalf("replay must not repeat provider work: %+v calls=%d %v", replay, d.calls, err)
	}
	s.req.Context.IdempotencyKey = "ensure-2"
	again, err := m.Ensure(context.Background(), s.req)
	if err != nil || again.Created || again.ID != first.ID || d.calls != 2 {
		t.Fatalf("new attempt must re-verify the same backend: %+v %v", again, err)
	}
	if got := strings.Join(events(t, db, s.req.Context.WorkspaceID), ","); got != "state_backend_provisioned,state_backend_verified" {
		t.Fatalf("audit events %s", got)
	}
	var settings string
	if err = db.QueryRow(`SELECT settings::text FROM provisr_iac.state_backends WHERE id=$1`, first.ID).Scan(&settings); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(settings, "external") || strings.Contains(settings, "arn:") || !strings.Contains(settings, "provisr-tfstate-") {
		t.Fatalf("settings must be non-secret names only: %s", settings)
	}
}

func TestConcurrentFirstRunsCreateOncePostgres(t *testing.T) {
	db := database(t)
	s := seed(t, db, "aws", "active")
	d := &recordingDriver{}
	m := manager(db, d)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := s.req
			r.Context.IdempotencyKey = uuid.NewString()
			_, err := m.Ensure(context.Background(), r)
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var rows int
	if err := db.QueryRow(`SELECT count(*) FROM provisr_iac.state_backends WHERE cloud_account_id=$1`, s.accountID).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("rows=%d %v", rows, err)
	}
	if d.firsts != 1 || d.calls != 8 {
		t.Fatalf("concurrent first runs not serialized: firsts=%d calls=%d", d.firsts, d.calls)
	}
}

func TestEnsureGuardsPostgres(t *testing.T) {
	db := database(t)
	expect := func(err error, code string) {
		t.Helper()
		var f *Failure
		if !errors.As(err, &f) || f.Code != code {
			t.Fatalf("want %s, got %v", code, err)
		}
	}
	d := &recordingDriver{}
	s := seed(t, db, "aws", "disconnected")
	_, err := manager(db, d).Ensure(context.Background(), s.req)
	expect(err, "cloud_account_not_active")
	s = seed(t, db, "aws", "active")
	if _, err = db.Exec(`UPDATE provisr_identity.memberships SET role='viewer' WHERE workspace_id=$1`, s.req.Context.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	_, err = manager(db, d).Ensure(context.Background(), s.req)
	expect(err, "forbidden")
	s = seed(t, db, "aws", "active")
	s.req.Provider = "gcp"
	_, err = manager(db, d).Ensure(context.Background(), s.req)
	expect(err, "cloud_account_not_active")
	s = seed(t, db, "azure", "active")
	_, err = manager(db, d).Ensure(context.Background(), s.req)
	expect(err, "provider_not_onboarded")
	var rows int
	if err = db.QueryRow(`SELECT count(*) FROM provisr_iac.state_backends WHERE cloud_account_id=$1`, s.accountID).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("unonboarded provider must not record a backend")
	}
	if d.calls != 0 {
		t.Fatal("guards must run before provider work")
	}
}

func TestFailureIsRecordedThenRecoversPostgres(t *testing.T) {
	db := database(t)
	s := seed(t, db, "aws", "active")
	d := &recordingDriver{err: errConflict}
	m := manager(db, d)
	if _, err := m.Ensure(context.Background(), s.req); !errors.Is(err, errConflict) {
		t.Fatal(err)
	}
	var status, code string
	if err := db.QueryRow(`SELECT status::text,last_error_code FROM provisr_iac.state_backends WHERE cloud_account_id=$1`, s.accountID).Scan(&status, &code); err != nil || status != "failed" || code != "backend_conflict" {
		t.Fatalf("failure not recorded: %s %s %v", status, code, err)
	}
	d.err = nil
	result, err := m.Ensure(context.Background(), s.req)
	if err != nil || result.Status != "ready" {
		t.Fatalf("same key must be retryable after failure: %v", err)
	}
	if got := strings.Join(events(t, db, s.req.Context.WorkspaceID), ","); got != "state_backend_failed,state_backend_provisioned" {
		t.Fatalf("audit events %s", got)
	}
}

func TestAuditFailureRollsBackBackendPostgres(t *testing.T) {
	db := database(t)
	s := seed(t, db, "aws", "active")
	_, err := db.Exec(`CREATE FUNCTION provisr_iac.test_reject_backend_audit() RETURNS trigger LANGUAGE plpgsql AS $$
	 BEGIN IF NEW.payload->>'cloud_account_id'='` + s.accountID + `' THEN RAISE EXCEPTION 'test rejection'; END IF; RETURN NEW; END $$;
	 CREATE TRIGGER test_reject_backend_audit BEFORE INSERT ON provisr_audit.audit_events FOR EACH ROW EXECUTE FUNCTION provisr_iac.test_reject_backend_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DROP TRIGGER test_reject_backend_audit ON provisr_audit.audit_events; DROP FUNCTION provisr_iac.test_reject_backend_audit()`)
	})
	if _, err = manager(db, &recordingDriver{}).Ensure(context.Background(), s.req); err == nil {
		t.Fatal("audit failure ignored")
	}
	var rows int
	if err = db.QueryRow(`SELECT count(*) FROM provisr_iac.state_backend_requests r JOIN provisr_iac.state_backends b ON b.id=r.state_backend_id
	 WHERE b.cloud_account_id=$1`, s.accountID).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("idempotent result committed without audit", err)
	}
}

func TestPrepareReturnsRunScopedInitConfigPostgres(t *testing.T) {
	db := database(t)
	s := seed(t, db, "aws", "active")
	m := manager(db, &recordingDriver{})
	values, err := m.Prepare(context.Background(), s.req, s.runID)
	if err != nil {
		t.Fatal(err)
	}
	if values["key"] != "workspaces/"+s.req.Context.WorkspaceID+"/runs/"+s.runID+"/terraform.tfstate" || values["region"] != "eu-west-1" || values["dynamodb_table"] == "" {
		t.Fatalf("unexpected init config %v", values)
	}
	other := seed(t, db, "aws", "active")
	s.req.Context.IdempotencyKey = "prepare-other"
	if _, err = m.Prepare(context.Background(), s.req, other.runID); err == nil {
		t.Fatal("run from another workspace accepted")
	}
}

func TestEnsureWithApplicationRolePostgres(t *testing.T) {
	db := database(t)
	s := seed(t, db, "aws", "active")
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
	d := &recordingDriver{err: errUnavailable}
	if _, err = manager(app, d).Ensure(context.Background(), s.req); !errors.Is(err, errUnavailable) {
		t.Fatal(err)
	}
	var status string
	if err = db.QueryRow(`SELECT status::text FROM provisr_iac.state_backends WHERE cloud_account_id=$1`, s.accountID).Scan(&status); err != nil || status != "failed" {
		t.Fatalf("application role could not record failure: %q %v", status, err)
	}
	d.err = nil
	if _, err = manager(app, d).Ensure(context.Background(), s.req); err != nil {
		t.Fatal(err)
	}
}
