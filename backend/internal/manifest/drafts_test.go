package manifest

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

const testToken = "test-only-manifest-token"

func TestPrivateManifestAuthorization(t *testing.T) {
	handler := NewDraftHandler(nil, nil, "http://mcp.invalid", testToken)
	for _, authorization := range []string{"", "Bearer incorrect"} {
		r := httptest.NewRequest("POST", "/v1/manifests", strings.NewReader(`{}`))
		r.Header.Set("Authorization", authorization)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("want 401, got %d", w.Code)
		}
	}
}

func TestInvalidPrivateManifestRequest(t *testing.T) {
	handler := NewDraftHandler(nil, nil, "http://mcp.invalid", testToken)
	for _, body := range []string{`{}`, `{"unknown":true}`, `{} {}`, `{"run_id":"not-a-uuid"}`} {
		r := httptest.NewRequest("POST", "/v1/manifests", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+testToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("want 400, got %d", w.Code)
		}
	}
}

func testDatabase(t *testing.T) *sql.DB {
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

func seedDraft(t *testing.T, db *sql.DB, role string) draftRequest {
	t.Helper()
	workspace, user, session, run, correlation := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec := func(sql string, args ...any) {
		if _, err := db.Exec(sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO provisr_identity.users (id,clerk_id,name,email) VALUES ($1,$2,'Test','test@example.invalid')`, user, user)
	exec(`INSERT INTO provisr_identity.workspaces (id,name,slug,environment) VALUES ($1,'Test',$2,'dev')`, workspace, workspace)
	exec(`INSERT INTO provisr_identity.memberships (workspace_id,user_id,role) VALUES ($1,$2,$3)`, workspace, user, role)
	exec(`INSERT INTO provisr_state.chat_sessions (id,workspace_id,user_id,title) VALUES ($1,$2,$3,'Test')`, session, workspace, user)
	cloud := map[string]any{"active_accounts": []any{map[string]any{"workspace_id": workspace, "provider": "aws", "status": "active", "verified_at": "2026-10-09T00:00:00Z", "supported_regions": []string{"us-east-1"}}}}
	policy := `{"enabled":false,"allowed_regions":[],"max_budget":null,"required_tags":{},"prohibited_resource_types":[],"required_encryption":false,"required_backup":false}`
	cloudJSON, _ := json.Marshal(cloud)
	exec(`INSERT INTO provisr_state.provisioning_runs (id,session_id,workspace_id,requester_id,prompt,idempotency_key,correlation_id,state,cloud_context,policy_requirements)
      VALUES ($1,$2,$3,$4,'Test',$5,$6,'MANIFEST_CREATING',$7,$8)`, run, session, workspace, user, run, correlation, cloudJSON, policy)
	return draftRequest{RunID: run, ExpectedStateVersion: 0, Content: json.RawMessage(`{"provider":"aws","region":"us-east-1","resources":[{"type":"aws_s3","name":"test-bucket"}]}`),
		Context: Context{WorkspaceID: workspace, UserID: user, SessionID: session, RequestID: run, CorrelationID: correlation, Permissions: []string{"manifest:write"}, IdempotencyKey: "manifest:" + run + ":0"}}
}

func testValidator(t *testing.T) *httptest.Server {
	t.Helper()
	validator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("Invalid MCP body")
		}
		// The backend must load authoritative snapshots; arbitrary client context is not accepted.
		if len(body["cloud_context"]) == 0 || len(body["policy_context"]) == 0 {
			t.Error("Missing persisted context")
		}
		var manifest map[string]any
		_ = json.Unmarshal(body["manifest"], &manifest)
		respond(w, 200, map[string]any{"valid": manifest["provider"] == "aws", "errors": []string{"provider validation failed"}})
	}))
	t.Cleanup(validator.Close)
	return validator
}
func send(handler http.Handler, body draftRequest) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest("POST", "/v1/manifests", bytes.NewReader(data))
	r.Header.Set("Authorization", "Bearer "+testToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestManifestStorePostgres(t *testing.T) {
	db := testDatabase(t)
	validator := testValidator(t)
	handler := NewDraftHandler(db, &http.Client{Timeout: time.Second}, validator.URL, testToken)
	body := seedDraft(t, db, "engineer")
	// Concurrent retries must produce a single version and a single audit append.
	var group sync.WaitGroup
	statuses := make(chan int, 8)
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() { defer group.Done(); statuses <- send(handler, body).Code }()
	}
	group.Wait()
	close(statuses)
	for status := range statuses {
		if status != 200 && status != 201 {
			t.Fatalf("store returned %d", status)
		}
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM provisr_manifest.manifests WHERE run_id=$1`, body.RunID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("manifest count %d, error %v", count, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM provisr_audit.audit_events WHERE resource_id=$1 AND event_type='manifest_created'`, body.RunID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("audit count %d, error %v", count, err)
	}
	body.Content = json.RawMessage(`{"provider":"aws","region":"us-west-2","resources":[]}`)
	if w := send(handler, body); w.Code != 409 {
		t.Fatalf("mismatched replay returned %d", w.Code)
	}
}

func TestManifestValidationAndMembershipPostgres(t *testing.T) {
	db := testDatabase(t)
	validator := testValidator(t)
	handler := NewDraftHandler(db, &http.Client{Timeout: time.Second}, validator.URL, testToken)
	viewer := seedDraft(t, db, "viewer")
	if w := send(handler, viewer); w.Code != 403 {
		t.Fatalf("viewer returned %d", w.Code)
	}
	invalid := seedDraft(t, db, "engineer")
	invalid.Content = json.RawMessage(`{"provider":"unsupported"}`)
	if w := send(handler, invalid); w.Code != 422 {
		t.Fatalf("invalid draft returned %d", w.Code)
	}
	var count int
	_ = db.QueryRow(`SELECT count(*) FROM provisr_manifest.manifests WHERE run_id=$1`, invalid.RunID).Scan(&count)
	if count != 0 {
		t.Fatal("Invalid draft was stored")
	}
}

func TestManifestAuditRollbackPostgres(t *testing.T) {
	db := testDatabase(t)
	validator := testValidator(t)
	handler := NewDraftHandler(db, &http.Client{Timeout: time.Second}, validator.URL, testToken)
	body := seedDraft(t, db, "engineer")
	_, err := db.Exec(`CREATE FUNCTION provisr_manifest.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.resource_id='` + body.RunID + `' THEN RAISE EXCEPTION 'test audit rejection'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_audit BEFORE INSERT ON provisr_audit.audit_events FOR EACH ROW EXECUTE FUNCTION provisr_manifest.test_reject_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DROP TRIGGER test_reject_audit ON provisr_audit.audit_events; DROP FUNCTION provisr_manifest.test_reject_audit()`)
	})
	if w := send(handler, body); w.Code != 503 {
		t.Fatalf("audit failure returned %d", w.Code)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM provisr_manifest.manifests WHERE run_id=$1`, body.RunID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback count %d,error %v", count, err)
	}
}
