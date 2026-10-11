package main

import "testing"

func TestIsActionAllowedMatrix(t *testing.T) {
	tests := []struct {
		name         string
		role         string
		resourceType string
		action       string
		want         bool
	}{
		{"admin all", "admin", "cloud_account", "create", true},
		{"admin unknown action", "admin", "anything", "whatever", true},
		{"engineer ops CRUD", "engineer", "cloud_account", "create", true},
		{"engineer cloud view", "engineer", "cloud_account", "view", true},
		{"engineer cloud update", "engineer", "cloud_account", "update", true},
		{"engineer cloud delete", "engineer", "cloud_account", "delete", true},
		{"engineer chat", "engineer", "chat_session", "create", true},
		{"engineer provisioning", "engineer", "provisioning_run", "create", true},
		{"engineer denied approve", "engineer", "approval_ticket", "decide", false},
		{"engineer denied audit", "engineer", "audit_event", "view", false},
		{"approver decide", "approver", "approval_ticket", "decide", true},
		{"approver run view", "approver", "provisioning_run", "view", true},
		{"approver denied cloud", "approver", "cloud_account", "create", false},
		{"auditor view", "auditor", "audit_event", "view", true},
		{"auditor artifact", "auditor", "artifact", "view", true},
		{"auditor denied decide", "auditor", "approval_ticket", "decide", false},
		{"viewer chat view", "viewer", "chat_session", "view", true},
		{"viewer run view", "viewer", "provisioning_run", "view", true},
		{"viewer denied cloud create", "viewer", "cloud_account", "create", false},
		{"viewer denied manifest", "viewer", "manifest", "view", false},
		{"unknown role", "superuser", "cloud_account", "create", false},
		{"unknown resource", "engineer", "billing", "view", false},
		{"empty action", "engineer", "cloud_account", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isActionAllowed(tt.role, tt.resourceType, tt.action); got != tt.want {
				t.Fatalf("isActionAllowed(%q, %q, %q) = %v, want %v", tt.role, tt.resourceType, tt.action, got, tt.want)
			}
		})
	}
}

func TestValidRole(t *testing.T) {
	for _, role := range []string{"admin", "engineer", "approver", "auditor", "viewer"} {
		if !validRole(role) {
			t.Fatalf("validRole(%q) = false, want true", role)
		}
	}
	for _, role := range []string{"", "owner", "viewer ", "ADMIN"} {
		if validRole(role) {
			t.Fatalf("validRole(%q) = true, want false", role)
		}
	}
}
