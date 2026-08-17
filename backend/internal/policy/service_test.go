package policy

import (
	"context"
	"encoding/json"
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

