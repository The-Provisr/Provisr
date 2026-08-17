package policy

import (
	"context"
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
