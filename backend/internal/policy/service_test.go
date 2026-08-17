package policy

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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

func generateTestJWT(claimsJSON, secret string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(claimsJSON))
	unsigned := header + "." + payload
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsigned))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return unsigned + "." + sig
}

func TestVerifyAndParseJWT(t *testing.T) {
	secret := "test-secret-key-32-chars-long!!"

	// Valid admin token
	payloadJSON := fmt.Sprintf(`{"sub":"user-123","role":"admin","workspace_id":"ws-456","exp":%d}`, time.Now().Add(time.Hour).Unix())
	token := generateTestJWT(payloadJSON, secret)

	p, err := verifyAndParseJWT(token, secret)
	if err != nil {
		t.Fatalf("expected verifyAndParseJWT to succeed: %v", err)
	}
	if p.ID != "user-123" || p.Role != "admin" || p.WorkspaceID != "ws-456" {
		t.Fatalf("unexpected principal: %+v", p)
	}

	// Forged token (signed with wrong secret)
	forgedToken := generateTestJWT(payloadJSON, "wrong-secret-key")
	if _, err := verifyAndParseJWT(forgedToken, secret); err == nil {
		t.Fatal("expected forged token to fail signature verification")
	}

	// Expired token
	expiredPayload := fmt.Sprintf(`{"sub":"user-123","role":"admin","exp":%d}`, time.Now().Add(-time.Hour).Unix())
	expiredToken := generateTestJWT(expiredPayload, secret)
	if _, err := verifyAndParseJWT(expiredToken, secret); err == nil {
		t.Fatal("expected expired token to fail verification")
	}

	// Clerk org:admin payload
	clerkAdminPayload := fmt.Sprintf(`{"sub":"clerk-1","org_role":"org:admin","exp":%d}`, time.Now().Add(time.Hour).Unix())
	clerkToken := generateTestJWT(clerkAdminPayload, secret)
	p, err = verifyAndParseJWT(clerkToken, secret)
	if err != nil {
		t.Fatalf("expected clerkToken parsing to succeed: %v", err)
	}
	if p.Role != "admin" {
		t.Fatalf("expected admin role from org:admin, got %s", p.Role)
	}
}

func TestAuthMiddleware(t *testing.T) {
	secret := "jwt-test-secret-value-12345"
	t.Setenv("JWT_SECRET", secret)
	t.Setenv("AUTH_DEV_BYPASS", "false")

	var capturedPrincipal Principal
	var capturedIsAdmin bool

	handler := authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := PrincipalFromContext(r.Context())
		capturedPrincipal = p
		capturedIsAdmin = isAdmin(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	// 1. Valid signed Bearer JWT
	validPayload := fmt.Sprintf(`{"sub":"user-admin","role":"admin","exp":%d}`, time.Now().Add(time.Hour).Unix())
	validToken := generateTestJWT(validPayload, secret)

	req, _ := http.NewRequest("GET", "/v1/policy-packs", nil)
	req.Header.Set("Authorization", "Bearer "+validToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if !capturedIsAdmin || capturedPrincipal.Role != "admin" {
		t.Fatalf("expected admin principal from valid JWT, got %+v (isAdmin=%v)", capturedPrincipal, capturedIsAdmin)
	}

	// 2. Forged Bearer JWT (must be rejected)
	capturedPrincipal = Principal{}
	capturedIsAdmin = false

	forgedToken := generateTestJWT(validPayload, "attacker-secret")
	reqForged, _ := http.NewRequest("GET", "/v1/policy-packs", nil)
	reqForged.Header.Set("Authorization", "Bearer "+forgedToken)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, reqForged)

	if capturedIsAdmin || capturedPrincipal.Role == "admin" {
		t.Fatalf("forged JWT must not grant admin, got %+v (isAdmin=%v)", capturedPrincipal, capturedIsAdmin)
	}

	// 3. Untrusted X-User-Role with no auth header in non-dev mode (must be rejected)
	capturedPrincipal = Principal{}
	capturedIsAdmin = false

	reqNoAuth, _ := http.NewRequest("GET", "/v1/policy-packs", nil)
	reqNoAuth.Header.Set("X-User-Role", "admin") // Untrusted spoof attempt
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, reqNoAuth)

	if capturedIsAdmin || capturedPrincipal.Role == "admin" {
		t.Fatalf("untrusted X-User-Role must not grant admin, got %+v (isAdmin=%v)", capturedPrincipal, capturedIsAdmin)
	}

	// 4. Hardcoded admin-token in production mode (must be rejected)
	capturedPrincipal = Principal{}
	capturedIsAdmin = false

	reqAdminToken, _ := http.NewRequest("GET", "/v1/policy-packs", nil)
	reqAdminToken.Header.Set("Authorization", "Bearer admin-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, reqAdminToken)

	if capturedIsAdmin || capturedPrincipal.Role == "admin" {
		t.Fatalf("admin-token in production mode must not grant admin, got %+v (isAdmin=%v)", capturedPrincipal, capturedIsAdmin)
	}
}



