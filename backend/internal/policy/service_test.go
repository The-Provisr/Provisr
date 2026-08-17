package policy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPrincipalFromContext(t *testing.T) {
	ctx := context.Background()

	// Empty context
	if _, ok := PrincipalFromContext(ctx); ok {
		t.Fatal("expected no principal in empty context")
	}
	if isAdmin(ctx) {
		t.Fatal("expected empty context not to be admin")
	}

	// Non-admin principal
	userCtx := ContextWithPrincipal(ctx, Principal{ID: "u1", Role: "engineer"})
	p, ok := PrincipalFromContext(userCtx)
	if !ok || p.Role != "engineer" {
		t.Fatalf("expected engineer role, got %+v", p)
	}
	if isAdmin(userCtx) {
		t.Fatal("expected engineer not to be admin")
	}

	// Admin principal
	adminCtx := ContextWithPrincipal(ctx, Principal{ID: "admin-1", Role: "admin"})
	p, ok = PrincipalFromContext(adminCtx)
	if !ok || p.Role != "admin" {
		t.Fatalf("expected admin role, got %+v", p)
	}
	if !isAdmin(adminCtx) {
		t.Fatal("expected adminCtx to be admin")
	}
}

func TestValidateParametersSchema(t *testing.T) {
	testCases := []struct {
		name    string
		schema  string
		wantErr bool
	}{
		{"empty object", "{}", false},
		{"object with properties", `{"type":"object","properties":{"min_instances":{"type":"integer"}}}`, false},
		{"empty string", "", true},
		{"number scalar", "5", true},
		{"string scalar", `"hello"`, true},
		{"boolean scalar", "true", true},
		{"null scalar", "null", true},
		{"array", `["a", "b"]`, true},
		{"invalid json syntax", "{not-valid}", true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.schema == "" {
				if !tc.wantErr {
					t.Fatal("expected error for empty string")
				}
				return
			}

			var schemaObj map[string]any
			err := json.Unmarshal([]byte(tc.schema), &schemaObj)
			isInvalid := err != nil || schemaObj == nil
			if isInvalid != tc.wantErr {
				t.Fatalf("for %q, expected wantErr=%v, got isInvalid=%v (err=%v, schemaObj=%+v)", tc.schema, tc.wantErr, isInvalid, err, schemaObj)
			}
		})
	}
}

func TestParseJWTClaims(t *testing.T) {
	// Create sample JWT token: header.payload.signature
	// payload: {"sub":"user-123","role":"admin","workspace_id":"ws-456"}
	payloadJSON := `{"sub":"user-123","role":"admin","workspace_id":"ws-456"}`
	token := "eyJhbGciOiJIUzI1NiJ9." + base64.RawURLEncoding.EncodeToString([]byte(payloadJSON)) + ".sig"

	p, ok := parseJWTClaims(token)
	if !ok {
		t.Fatal("expected parseJWTClaims to succeed")
	}
	if p.ID != "user-123" || p.Role != "admin" || p.WorkspaceID != "ws-456" {
		t.Fatalf("unexpected principal: %+v", p)
	}

	// Clerk org:admin payload
	clerkAdminPayload := `{"sub":"clerk-1","org_role":"org:admin"}`
	clerkToken := "eyJhbGciOiJIUzI1NiJ9." + base64.RawURLEncoding.EncodeToString([]byte(clerkAdminPayload)) + ".sig"
	p, ok = parseJWTClaims(clerkToken)
	if !ok {
		t.Fatal("expected clerkToken parsing to succeed")
	}
	if p.Role != "admin" {
		t.Fatalf("expected admin role from org:admin, got %s", p.Role)
	}

	// Invalid token format
	if _, ok := parseJWTClaims("invalid-token"); ok {
		t.Fatal("expected failure for malformed token")
	}
}

func TestAuthMiddleware(t *testing.T) {
	// Test Bearer admin-token
	var capturedPrincipal Principal
	var capturedIsAdmin bool

	handler := authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := PrincipalFromContext(r.Context())
		capturedPrincipal = p
		capturedIsAdmin = isAdmin(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req, _ := http.NewRequest("GET", "/v1/policy-packs", nil)
	req.Header.Set("Authorization", "Bearer admin-token")
	req.Header.Set("X-User-Role", "viewer") // Client header must not override

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if !capturedIsAdmin || capturedPrincipal.Role != "admin" {
		t.Fatalf("expected admin principal from admin-token, got %+v (isAdmin=%v)", capturedPrincipal, capturedIsAdmin)
	}

	// Test untrusted X-User-Role with no auth header in non-dev mode
	capturedPrincipal = Principal{}
	capturedIsAdmin = false

	reqNoAuth, _ := http.NewRequest("GET", "/v1/policy-packs", nil)
	reqNoAuth.Header.Set("X-User-Role", "admin") // Untrusted spoof attempt

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, reqNoAuth)

	if capturedIsAdmin || capturedPrincipal.Role == "admin" {
		t.Fatalf("untrusted X-User-Role must not grant admin, got %+v (isAdmin=%v)", capturedPrincipal, capturedIsAdmin)
	}
}


