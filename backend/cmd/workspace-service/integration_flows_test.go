package main

import (
	"database/sql"
	"fmt"
	"testing"
)

// createWorkspace seeds context via the API and returns the workspace id.
func createWorkspace(t *testing.T, db *sql.DB, url, adminID string) string {
	t.Helper()
	payload := fmt.Sprintf(
		`{"name":"Sprint Team","environment":"dev","creator_id":%q}`, adminID)
	resp, body := doJSON(t, "POST", url+"/workspaces", payload, map[string]string{"Idempotency-Key": "k-create-ws-" + adminID})
	assertStatus(t, 201, resp)
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("create workspace: missing id in %v", body)
	}
	return id
}

func TestWorkspaceLifecycle(t *testing.T) {
	srv, url := setupTestServer(t)
	_ = srv

	admin := newUUID()
	seedUser(t, srv.db, admin, "admin@example.org")

	wsID := createWorkspace(t, srv.db, url, admin)

	resp, body := doJSON(t, "GET", url+"/workspaces/"+wsID+"?user_id="+admin, "", nil)
	assertStatus(t, 200, resp)
	if body["slug"] == nil || body["id"] != wsID {
		t.Fatalf("unexpected get response: %v", body)
	}
	members := body["members"].([]any)
	if len(members) != 1 {
		t.Fatalf("expected 1 member, got %d", len(members))
	}

	resp, _ = doJSON(t, "GET", url+"/workspaces?user_id="+admin, "", nil)
	assertStatus(t, 200, resp)

	resp, _ = doJSON(t, "GET", url+"/workspaces", "", nil)
	assertStatus(t, 400, resp)

	resp, body = doJSON(t, "PATCH", url+"/workspaces/"+wsID, `{"environment":"prod"}`, map[string]string{"Idempotency-Key": "k-patch-ws"})
	assertStatus(t, 200, resp)
	if body["environment"] != "prod" {
		t.Fatalf("environment not updated: %v", body)
	}

	resp, _ = doJSON(t, "PATCH", url+"/workspaces/"+wsID, `{"environment":"mars"}`, map[string]string{"Idempotency-Key": "k-patch-invalid"})
	assertStatus(t, 400, resp)

	resp, _ = doJSON(t, "DELETE", url+"/workspaces/"+wsID, "", map[string]string{"Idempotency-Key": "k-del-ws"})
	assertStatus(t, 204, resp)

	resp, _ = doJSON(t, "GET", url+"/workspaces/"+wsID+"?user_id="+admin, "", nil)
	assertStatus(t, 404, resp)
}

func TestMemberManagement(t *testing.T) {
	s, url := setupTestServer(t)
	admin := newUUID()
	seedUser(t, s.db, admin, "admin@example.org")
	wsID := createWorkspace(t, s.db, url, admin)

	engineer := newUUID()
	seedUser(t, s.db, engineer, "engineer@example.org")
	ghost := newUUID()

	// invalid role and missing user are rejected before any state change
	resp, _ := doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"boss"}`, engineer), map[string]string{"Idempotency-Key": "k-invalid-role"})
	assertStatus(t, 400, resp)

	resp, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, ghost), map[string]string{"Idempotency-Key": "k-ghost"})
	assertStatus(t, 404, resp)

	resp, body := doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, engineer), map[string]string{"Idempotency-Key": "k-add-1"})
	assertStatus(t, 201, resp)
	if body["role"] != "engineer" {
		t.Fatalf("unexpected member: %v", body)
	}

	// duplicate membership is a conflict, not a silent no-op
	resp, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"viewer"}`, engineer), map[string]string{"Idempotency-Key": "k-add-2"})
	assertStatus(t, 409, resp)

	resp, listRaw := doRaw(t, "GET", url+"/workspaces/"+wsID+"/members?role=admin", "", nil)
	assertStatus(t, 200, resp)
	adminMembers, ok := listRaw.([]any)
	if !ok || len(adminMembers) != 1 {
		t.Fatalf("role filter admin expected 1 member, got %v", listRaw)
	}

	resp, _ = doJSON(t, "GET", url+"/workspaces/"+wsID+"/members?role=wizard", "", nil)
	assertStatus(t, 400, resp)

	// role update
	resp, _ = doJSON(t, "PATCH", url+"/workspaces/"+wsID+"/members/"+engineer,
		`{"role":"approver"}`, map[string]string{"Idempotency-Key": "k-role-1"})
	assertStatus(t, 204, resp)

	// last admin cannot be demoted
	resp, body = doJSON(t, "PATCH", url+"/workspaces/"+wsID+"/members/"+admin,
		`{"role":"viewer"}`, map[string]string{"Idempotency-Key": "k-role-2"})
	assertStatus(t, 409, resp)
	if body["error"] != "last_admin" {
		t.Fatalf("expected last_admin conflict, got %v", body)
	}

	// remove member, then removal of the last admin is blocked
	resp, _ = doJSON(t, "DELETE", url+"/workspaces/"+wsID+"/members/"+engineer, "", map[string]string{"Idempotency-Key": "k-rm-1"})
	assertStatus(t, 204, resp)
	resp, _ = doJSON(t, "DELETE", url+"/workspaces/"+wsID+"/members/"+admin, "", map[string]string{"Idempotency-Key": "k-rm-2"})
	assertStatus(t, 409, resp)

	// removing a non-member is a 404
	resp, _ = doJSON(t, "DELETE", url+"/workspaces/"+wsID+"/members/"+engineer, "", map[string]string{"Idempotency-Key": "k-rm-3"})
	assertStatus(t, 404, resp)
}

func TestMemberBlockedByActiveRuns(t *testing.T) {
	srv, url := setupTestServer(t)
	admin := newUUID()
	seedUser(t, srv.db, admin, "admin@example.org")
	wsID := createWorkspace(t, srv.db, url, admin)

	member := newUUID()
	seedUser(t, srv.db, member, "member@example.org")
	_, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, member), map[string]string{"Idempotency-Key": "k-add"})

	seedActiveRun(t, srv.db, wsID, member)

	resp, body := doJSON(t, "DELETE", url+"/workspaces/"+wsID+"/members/"+member, "", map[string]string{"Idempotency-Key": "k-rm-active"})
	assertStatus(t, 409, resp)
	if body["error"] != "active_runs_exist" {
		t.Fatalf("expected active_runs_exist, got %v", body)
	}

	resp, _ = doJSON(t, "DELETE", url+"/workspaces/"+wsID, "", map[string]string{"Idempotency-Key": "k-del-blocked"})
	assertStatus(t, 409, resp)
}

func seedActiveRun(t *testing.T, db *sql.DB, workspaceID, userID string) {
	t.Helper()
	var sessionID string
	if err := db.QueryRow(
		`INSERT INTO provisr_state.chat_sessions (workspace_id, user_id, title)
		 VALUES ($1, $2, 'run session') RETURNING id`,
		workspaceID, userID,
	).Scan(&sessionID); err != nil {
		t.Fatalf("seed chat session: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO provisr_state.provisioning_runs
		 (session_id, workspace_id, requester_id, state, prompt, idempotency_key, correlation_id)
		 VALUES ($1, $2, $3, 'pending_approval', 'deploy', $4, $5)`,
		sessionID, workspaceID, userID, newUUID(), newUUID(),
	); err != nil {
		t.Fatalf("seed provisioning run: %v", err)
	}
}

func TestInvitationLifecycle(t *testing.T) {
	srv, url := setupTestServer(t)
	admin := newUUID()
	seedUser(t, srv.db, admin, "admin@example.org")
	wsID := createWorkspace(t, srv.db, url, admin)

	resp, body := doJSON(t, "POST", url+"/workspaces/"+wsID+"/invitations",
		`{"email":"invitee@example.org","role":"engineer"}`, map[string]string{"Idempotency-Key": "k-inv-1"})
	assertStatus(t, 201, resp)
	code, _ := body["code"].(string)
	invID, _ := body["id"].(string)
	if code == "" || invID == "" {
		t.Fatalf("invitation missing code/id: %v", body)
	}

	// lookup by code
	resp, body = doJSON(t, "GET", url+"/invitations?code="+code, "", nil)
	assertStatus(t, 200, resp)
	if body["email"] != "invitee@example.org" {
		t.Fatalf("unexpected invitation: %v", body)
	}

	// get by id
	resp, _ = doJSON(t, "GET", url+"/workspaces/"+wsID+"/invitations/"+invID, "", nil)
	assertStatus(t, 200, resp)

	// accept with mismatched email is forbidden
	newUser := newUUID()
	resp, body = doJSON(t, "POST", url+"/invitations/accept?code="+code,
		fmt.Sprintf(`{"user_id":%q,"name":"Hacker","email":"hacker@example.org"}`, newUser),
		map[string]string{"Idempotency-Key": "k-accept-mismatch"})
	assertStatus(t, 403, resp)
	if body["error"] != "email_mismatch" {
		t.Fatalf("expected email_mismatch, got %v", body)
	}

	// key from the rejected attempt must not be burned
	resp, body = doJSON(t, "POST", url+"/invitations/accept?code="+code,
		fmt.Sprintf(`{"user_id":%q,"name":"Invitee","email":"invitee@example.org"}`, newUser),
		map[string]string{"Idempotency-Key": "k-accept-mismatch"})
	assertStatus(t, 200, resp)
	if body["role"] != "engineer" {
		t.Fatalf("unexpected accepted member: %v", body)
	}

	// user was auto-created on first accept
	var count int
	if err := srv.db.QueryRow(`SELECT COUNT(*) FROM provisr_identity.users WHERE id = $1`, newUser).Scan(&count); err != nil {
		t.Fatalf("check auto-created user: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected auto-created user row, got %d", count)
	}

	// invitation consumed: second accept and code lookup are both 410
	resp, _ = doJSON(t, "POST", url+"/invitations/accept?code="+code,
		fmt.Sprintf(`{"user_id":%q,"name":"Again","email":"invitee@example.org"}`, newUUID()),
		map[string]string{"Idempotency-Key": "k-accept-again"})
	assertStatus(t, 410, resp)
	resp, body = doJSON(t, "GET", url+"/invitations?code="+code, "", nil)
	assertStatus(t, 410, resp)
	if body["error"] != "revoked" {
		t.Fatalf("expected revoked, got %v", body)
	}
}

func TestInvitationRevokedAndExpired(t *testing.T) {
	srv, url := setupTestServer(t)
	admin := newUUID()
	seedUser(t, srv.db, admin, "admin@example.org")
	wsID := createWorkspace(t, srv.db, url, admin)

	resp, body := doJSON(t, "POST", url+"/workspaces/"+wsID+"/invitations",
		`{"email":"revoke@example.org","role":"viewer"}`, map[string]string{"Idempotency-Key": "k-inv-r1"})
	assertStatus(t, 201, resp)
	code, _ := body["code"].(string)
	invID, _ := body["id"].(string)

	resp, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/invitations/"+invID+"/revoke", "", map[string]string{"Idempotency-Key": "k-inv-rv1"})
	assertStatus(t, 204, resp)
	resp, _ = doJSON(t, "GET", url+"/invitations?code="+code, "", nil)
	assertStatus(t, 410, resp)

	// expired invitation (seeded directly)
	resp, body = doJSON(t, "POST", url+"/workspaces/"+wsID+"/invitations",
		`{"email":"expired@example.org","role":"viewer"}`, map[string]string{"Idempotency-Key": "k-inv-r2"})
	assertStatus(t, 201, resp)
	expiredCode, _ := body["code"].(string)
	if _, err := srv.db.Exec(
		`UPDATE provisr_identity.invitations SET expires_at = now() - interval '1 hour' WHERE code = $1`,
		expiredCode,
	); err != nil {
		t.Fatalf("backdate invitation: %v", err)
	}

	resp, body = doJSON(t, "GET", url+"/invitations?code="+expiredCode, "", nil)
	assertStatus(t, 410, resp)
	if body["error"] != "expired" {
		t.Fatalf("expected expired, got %v", body)
	}
	resp, _ = doJSON(t, "POST", url+"/invitations/accept?code="+expiredCode,
		fmt.Sprintf(`{"user_id":%q,"name":"Expired","email":"expired@example.org"}`, newUUID()),
		map[string]string{"Idempotency-Key": "k-accept-exp"})
	assertStatus(t, 410, resp)
}

func TestPermissionCheckEndpoint(t *testing.T) {
	srv, url := setupTestServer(t)
	admin := newUUID()
	seedUser(t, srv.db, admin, "admin@example.org")
	wsID := createWorkspace(t, srv.db, url, admin)

	engineer := newUUID()
	seedUser(t, srv.db, engineer, "engineer@example.org")
	_, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, engineer),
		map[string]string{"Idempotency-Key": "k-perm-1"})

	check := func(user, action, resource string) map[string]any {
		resp, body := doJSON(t, "POST", url+"/permissions/check",
			fmt.Sprintf(`{"user_id":%q,"workspace_id":%q,"action":%q,"resource_type":%q}`,
				user, wsID, action, resource), nil)
		assertStatus(t, 200, resp)
		return body
	}

	if got := check(engineer, "create", "cloud_account"); got["allowed"] != true {
		t.Fatalf("engineer should create cloud_account: %v", got)
	}
	if got := check(engineer, "decide", "approval_ticket"); got["allowed"] != false {
		t.Fatalf("engineer must not decide approval_ticket: %v", got)
	}
	if got := check(admin, "decide", "approval_ticket"); got["allowed"] != true {
		t.Fatalf("admin allows everything: %v", got)
	}
	if got := check(newUUID(), "view", "chat_session"); got["allowed"] != false {
		t.Fatalf("non-member must be denied: %v", got)
	}

	// invalid requests
	resp, _ := doJSON(t, "POST", url+"/permissions/check",
		`{"user_id":"x","workspace_id":"y","action":"","resource_type":""}`, nil)
	assertStatus(t, 400, resp)

	// batch: mixed allow/deny + non-member
	resp, body := doJSON(t, "POST", url+"/permissions/check-batch",
		fmt.Sprintf(`{"checks":[
			{"user_id":%q,"workspace_id":%q,"action":"create","resource_type":"cloud_account"},
			{"user_id":%q,"workspace_id":%q,"action":"decide","resource_type":"approval_ticket"},
			{"user_id":%q,"workspace_id":%q,"action":"view","resource_type":"chat_session"}
		]}`, engineer, wsID, engineer, wsID, newUUID(), wsID), nil)
	assertStatus(t, 200, resp)
	results := body["results"].([]any)
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
	if r, _ := results[0].(map[string]any); r["allowed"] != true {
		t.Fatalf("batch[0] should be allowed: %v", results[0])
	}
	if r, _ := results[1].(map[string]any); r["allowed"] != false {
		t.Fatalf("batch[1] should be denied: %v", results[1])
	}
	if r, _ := results[2].(map[string]any); r["allowed"] != false {
		t.Fatalf("batch[2] non-member must be denied: %v", results[2])
	}

	resp, _ = doJSON(t, "POST", url+"/permissions/check-batch", `{"checks":[]}`, nil)
	assertStatus(t, 400, resp)
}

func TestIdempotencyKeys(t *testing.T) {
	srv, url := setupTestServer(t)
	admin := newUUID()
	seedUser(t, srv.db, admin, "admin@example.org")
	wsID := createWorkspace(t, srv.db, url, admin)

	member := newUUID()
	seedUser(t, srv.db, member, "member@example.org")

	// missing key -> 400, no state change
	resp, _ := doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, member), nil)
	assertStatus(t, 400, resp)

	// first mutation with key succeeds
	resp, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, member),
		map[string]string{"Idempotency-Key": "key-add-member"})
	assertStatus(t, 201, resp)

	// replay of same key -> 409 duplicate_idempotency_key
	resp, body := doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, member),
		map[string]string{"Idempotency-Key": "key-add-member"})
	assertStatus(t, 409, resp)
	if body["error"] != "duplicate_idempotency_key" {
		t.Fatalf("expected duplicate_idempotency_key, got %v", body)
	}

	// different key, same mutation -> the conflict surfaces
	resp, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, member),
		map[string]string{"Idempotency-Key": "key-add-member-2"})
	assertStatus(t, 409, resp)

	// key scoped per workspace: same key on another workspace is fresh
	other := newUUID()
	seedUser(t, srv.db, other, "other@example.org")
	ws2ID := createWorkspace(t, srv.db, url, other)
	resp, _ = doJSON(t, "POST", url+"/workspaces/"+ws2ID+"/members",
		fmt.Sprintf(`{"user_id":%q,"role":"engineer"}`, admin),
		map[string]string{"Idempotency-Key": "key-add-member"})
	assertStatus(t, 201, resp)

	// invitation idempotency: create + replay + accept + replay
	invResp, invBody := doJSON(t, "POST", url+"/workspaces/"+wsID+"/invitations",
		`{"email":"idem@example.org","role":"viewer"}`, map[string]string{"Idempotency-Key": "key-inv-1"})
	assertStatus(t, 201, invResp)
	code, _ := invBody["code"].(string)

	invResp, _ = doJSON(t, "POST", url+"/workspaces/"+wsID+"/invitations",
		`{"email":"idem@example.org","role":"viewer"}`, map[string]string{"Idempotency-Key": "key-inv-1"})
	assertStatus(t, 409, invResp)

	acc := newUUID()
	accResp, _ := doJSON(t, "POST", url+"/invitations/accept?code="+code,
		fmt.Sprintf(`{"user_id":%q,"name":"Idem","email":"idem@example.org"}`, acc),
		map[string]string{"Idempotency-Key": "key-accept-1"})
	assertStatus(t, 200, accResp)

	accResp, _ = doJSON(t, "POST", url+"/invitations/accept?code="+code,
		fmt.Sprintf(`{"user_id":%q,"name":"Idem","email":"idem@example.org"}`, acc),
		map[string]string{"Idempotency-Key": "key-accept-1"})
	assertStatus(t, 409, accResp)

	// role update idempotency
	upResp, _ := doJSON(t, "PATCH", url+"/workspaces/"+wsID+"/members/"+member,
		`{"role":"approver"}`, map[string]string{"Idempotency-Key": "key-role-1"})
	assertStatus(t, 204, upResp)
	upResp, _ = doJSON(t, "PATCH", url+"/workspaces/"+wsID+"/members/"+member,
		`{"role":"approver"}`, map[string]string{"Idempotency-Key": "key-role-1"})
	assertStatus(t, 409, upResp)

	// remove idempotency
	rmResp, _ := doJSON(t, "DELETE", url+"/workspaces/"+wsID+"/members/"+member, "", map[string]string{"Idempotency-Key": "key-rm-1"})
	assertStatus(t, 204, rmResp)
	rmResp, _ = doJSON(t, "DELETE", url+"/workspaces/"+wsID+"/members/"+member, "", map[string]string{"Idempotency-Key": "key-rm-1"})
	assertStatus(t, 409, rmResp)
}

func assertEqual(t *testing.T, want, got any) {
	t.Helper()
	if want != got {
		t.Fatalf("got %v, want %v", got, want)
	}
}
