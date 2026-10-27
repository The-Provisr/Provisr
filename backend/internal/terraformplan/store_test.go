package terraformplan

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/provisr/backend/internal/cloudaccount"
	"github.com/provisr/backend/internal/iacartifact"
	"github.com/provisr/backend/internal/statebackend"
	"github.com/provisr/backend/pkg/cloudcrypto"
)

type fakeBackend struct{}

func (fakeBackend) Prepare(context.Context, statebackend.Request, string) (map[string]string, error) {
	return map[string]string{"bucket": "controlled"}, nil
}

type recordingRunner struct {
	calls   atomic.Int32
	failure error
}

func (r *recordingRunner) Plan(_ context.Context, _ *iacartifact.Artifact, _ map[string]string, _ []string) (Output, error) {
	r.calls.Add(1)
	if r.failure != nil {
		return Output{}, r.failure
	}
	return Output{Binary: []byte("private binary plan"), JSON: []byte(`{"format_version":"1.2","planned_values":{},"resource_changes":[{"address":"aws_s3_bucket.example","type":"aws_s3_bucket","change":{"actions":["create"],"after":{"password":"private-value"},"after_sensitive":{"password":true}}}]}`)}, nil
}

func database(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required for disposable PostgreSQL proof")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(u.Path, "/provisr_or_planning_test_") {
		t.Fatal("Use disposable provisr_or_planning_test_* database")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
func seedPlan(t *testing.T, db *sql.DB) (Request, *Service, *recordingRunner) {
	t.Helper()
	r := request()
	c := r.Context
	manifestID := uuid.NewString()
	master := cloudcrypto.MasterKey(bytes.Repeat([]byte{7}, 32))
	key, _ := cloudcrypto.DeriveWorkspaceKey(master, c.WorkspaceID)
	encrypted, err := cloudcrypto.EncryptJSON(key, map[string]string{"role_arn": "arn:aws:iam::123456789012:role/Provisr", "external_id": "test", "default_region": "us-east-1"})
	if err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO provisr_identity.users(id,clerk_id,name,email) VALUES($1,$2,'Test','test@example.invalid')`, c.UserID, c.UserID)
	exec(`INSERT INTO provisr_identity.workspaces(id,name,slug,environment) VALUES($1,'Plan test',$2,'dev')`, c.WorkspaceID, c.WorkspaceID)
	exec(`INSERT INTO provisr_identity.memberships(workspace_id,user_id,role) VALUES($1,$2,'engineer')`, c.WorkspaceID, c.UserID)
	exec(`INSERT INTO provisr_state.chat_sessions(id,workspace_id,user_id,title) VALUES($1,$2,$3,'Test')`, c.SessionID, c.WorkspaceID, c.UserID)
	exec(`INSERT INTO provisr_state.provisioning_runs(id,session_id,workspace_id,requester_id,prompt,idempotency_key,correlation_id,state) VALUES($1,$2,$3,$4,'Test',$6,$5,'IAC_GENERATING')`, c.RequestID, c.SessionID, c.WorkspaceID, c.UserID, c.CorrelationID, c.RequestID)
	exec(`INSERT INTO provisr_manifest.manifests(id,run_id,version,content) VALUES($1,$2,1,$3)`, manifestID, c.RequestID, `{"schema_version":"1.0","provider":"aws","region":"us-east-1","resources":[{"logical_name":"bucket","type":"storage.aws.s3","properties":{"name":"private-plan-test-bucket","versioning":false}}]}`)
	exec(`UPDATE provisr_state.provisioning_runs SET manifest_version=1,manifest_validated_version=1,manifest_confirmed_version=1,manifest_confirmed_at=now() WHERE id=$1`, c.RequestID)
	exec(`INSERT INTO provisr_cloud.cloud_accounts(workspace_id,provider,label,status,verified_at,metadata_encrypted) VALUES($1,'aws','Test','active',now(),$2)`, c.WorkspaceID, encrypted)
	data, _ := json.Marshal(iacartifact.Request{Context: c, ManifestID: manifestID})
	req := httptest.NewRequest("POST", "/v1/iac/generate", bytes.NewReader(data))
	req.Header.Set("Authorization", "Bearer test")
	w := httptest.NewRecorder()
	iacartifact.New(db, "test").ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("generation seed failed", w.Code, w.Body.String())
	}
	var a iacartifact.Artifact
	if json.Unmarshal(w.Body.Bytes(), &a) != nil {
		t.Fatal("invalid generation fixture")
	}
	r.ArtifactID = a.ID
	exec(`UPDATE provisr_state.provisioning_runs SET state='PLAN_CREATING',iac_artifact_id=$2 WHERE id=$1`, c.RequestID, a.ID)
	runner := &recordingRunner{}
	s := &Service{db: db, master: master, backend: fakeBackend{}, runner: runner, credentials: func(context.Context, cloudaccount.CapabilityAccount) ([]string, error) {
		return []string{"AWS_SESSION_TOKEN=test-only"}, nil
	}}
	return r, s, runner
}
func code(t *testing.T, err error, want string) {
	t.Helper()
	var f *Failure
	if !errors.As(err, &f) || f.Code != want {
		t.Fatalf("want %s, got %v", want, err)
	}
}

func TestPostgresConcurrentReplayEncryptionAndAudit(t *testing.T) {
	db := database(t)
	r, s, runner := seedPlan(t, db)
	var wg sync.WaitGroup
	ids := make(chan string, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, err := s.Create(context.Background(), r)
			if err != nil {
				t.Error(err)
				return
			}
			ids <- v.ID
		}()
	}
	wg.Wait()
	close(ids)
	id := ""
	for got := range ids {
		if id != "" && id != got {
			t.Fatal("duplicate plans")
		}
		id = got
	}
	if runner.calls.Load() != 1 {
		t.Fatal("replay reran Terraform")
	}
	var ciphertext string
	var response []byte
	if err := db.QueryRow(`SELECT encrypted_plan,response FROM provisr_iac.plans WHERE artifact_id=$1`, id).Scan(&ciphertext, &response); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ciphertext, "private-value") || bytes.Contains(response, []byte("private-value")) {
		t.Fatal("plaintext plan leaked")
	}
	key, _ := cloudcrypto.DeriveWorkspaceKey(s.master, r.Context.WorkspaceID+"/terraform-plan/v1")
	var contents map[string]any
	if cloudcrypto.DecryptJSON(key, ciphertext, &contents) != nil || contents["plan_artifact_id"] != id {
		t.Fatal("encrypted plan unavailable")
	}
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM provisr_audit.audit_events WHERE resource_id=$1 AND event_type='artifact_generated'`, id).Scan(&n)
	if n != 1 {
		t.Fatal("missing/duplicate plan audit")
	}
	if _, err := db.Exec(`UPDATE provisr_iac.plans SET encrypted_plan='tampered' WHERE artifact_id=$1`, id); err == nil {
		t.Fatal("plan mutation allowed")
	}
	if _, err := db.Exec(`UPDATE provisr_iac.artifacts SET hash=repeat('0',64) WHERE id=$1`, id); err == nil {
		t.Fatal("artifact mutation allowed")
	}
	if _, err := db.Exec(`UPDATE provisr_state.provisioning_runs SET state='POLICY_CHECKING' WHERE id=$1`, r.Context.RequestID); err != nil {
		t.Fatal(err)
	}
	if v, err := s.Create(context.Background(), r); err != nil || v.ID != id {
		t.Fatal("advanced state replay failed", err)
	}
}

func TestPostgresRejectsStaleForeignAndUnprivilegedPlans(t *testing.T) {
	db := database(t)
	for _, tc := range []struct {
		name, sql, want string
		mutate          func(*Request)
	}{
		{"stale manifest", `UPDATE provisr_state.provisioning_runs SET manifest_confirmed_version=NULL,manifest_confirmed_at=NULL WHERE id=$1`, "manifest_not_confirmed", nil},
		{"wrong state", `UPDATE provisr_state.provisioning_runs SET state='FAILED' WHERE id=$1`, "invalid_run_state", nil},
		{"wrong artifact", "", "not_found", func(r *Request) { r.ArtifactID = uuid.NewString() }},
		{"foreign workspace", "", "forbidden", func(r *Request) { r.Context.WorkspaceID = uuid.NewString() }},
		{"wrong session", "", "manifest_not_confirmed", func(r *Request) { r.Context.SessionID = uuid.NewString() }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, s, runner := seedPlan(t, db)
			if tc.sql != "" {
				if _, err := db.Exec(tc.sql, r.Context.RequestID); err != nil {
					t.Fatal(err)
				}
			}
			if tc.mutate != nil {
				tc.mutate(&r)
			}
			_, err := s.Create(context.Background(), r)
			code(t, err, tc.want)
			if runner.calls.Load() != 0 {
				t.Fatal("unauthorized runner called")
			}
		})
	}
}

func TestPostgresFailureLeavesAuditWithoutPlan(t *testing.T) {
	db := database(t)
	r, s, runner := seedPlan(t, db)
	runner.failure = fail(422, "terraform_plan_failed", "safe failure")
	_, err := s.Create(context.Background(), r)
	code(t, err, "terraform_plan_failed")
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM provisr_iac.plans WHERE run_id=$1`, r.Context.RequestID).Scan(&n)
	if n != 0 {
		t.Fatal("failed plan persisted")
	}
	_ = db.QueryRow(`SELECT count(*) FROM provisr_audit.audit_events WHERE resource_id=$1 AND event_type='error'`, r.Context.RequestID).Scan(&n)
	if n != 1 {
		t.Fatal("missing failure audit")
	}
}

func TestPostgresApplicationRoleCanPlanButCannotMutate(t *testing.T) {
	db := database(t)
	r, s, _ := seedPlan(t, db)
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, err := db.Exec(`SET ROLE provisr_app`); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`RESET ROLE`) }()
	v, err := s.Create(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`DELETE FROM provisr_iac.plans WHERE artifact_id=$1`, v.ID); err == nil {
		t.Fatal("application role can delete plans")
	}
}

func TestPostgresAuditFailureRollsBackPlan(t *testing.T) {
	db := database(t)
	r, s, _ := seedPlan(t, db)
	_, err := db.Exec(`CREATE FUNCTION provisr_iac.reject_test_plan_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type='plan_artifact' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_plan_audit BEFORE INSERT ON provisr_audit.audit_events FOR EACH ROW EXECUTE FUNCTION provisr_iac.reject_test_plan_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`DROP TRIGGER reject_test_plan_audit ON provisr_audit.audit_events; DROP FUNCTION provisr_iac.reject_test_plan_audit()`)
	}()
	if _, err = s.Create(context.Background(), r); err == nil {
		t.Fatal("plan stored without audit")
	}
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM provisr_iac.artifacts WHERE run_id=$1 AND type='plan'`, r.Context.RequestID).Scan(&n)
	if n != 0 {
		t.Fatal("plan metadata escaped rollback")
	}
}
