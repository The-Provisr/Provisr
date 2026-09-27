package cloudaccount

import (
	"strings"
	"testing"
)

func TestValidProvider(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		want     bool
	}{
		{"aws", "aws", true},
		{"azure", "azure", true},
		{"gcp", "gcp", true},
		{"unknown", "gcp2", false},
		{"empty", "", false},
		{"upper case", "AWS", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validProvider(tt.provider); got != tt.want {
				t.Fatalf("validProvider(%q) = %v, want %v", tt.provider, got, tt.want)
			}
		})
	}
}

func TestValidStatus(t *testing.T) {
	tests := []struct {
		name   string
		status string
		want   bool
	}{
		{"pending", "pending", true},
		{"active", "active", true},
		{"failed", "failed", true},
		{"disconnected", "disconnected", true},
		{"unknown", "connected", false},
		{"empty", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validStatus(tt.status); got != tt.want {
				t.Fatalf("validStatus(%q) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

func TestValidLabel(t *testing.T) {
	tests := []struct {
		name  string
		label string
		want  bool
	}{
		{"normal", "prod-account", true},
		{"min length", "x", true},
		{"max length", strings.Repeat("a", 255), true},
		{"too long", strings.Repeat("a", 256), false},
		{"empty", "", false},
		{"whitespace only", "   ", false},
		{"whitespace padded", "  prod  ", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validLabel(tt.label); got != tt.want {
				t.Fatalf("validLabel(%q) = %v, want %v", tt.label, got, tt.want)
			}
		})
	}
}

func TestValidWorkspaceID(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want bool
	}{
		{"valid uuid", "6ba7b810-9dad-11d1-80b4-00c04fd430c8", true},
		{"not a uuid", "not-a-uuid", false},
		{"empty", "", false},
		{"short uuid", "6ba7b810", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validWorkspaceID(tt.id); got != tt.want {
				t.Fatalf("validWorkspaceID(%q) = %v, want %v", tt.id, got, tt.want)
			}
		})
	}
}

func TestValidExternalAccountID(t *testing.T) {
	tests := []struct {
		name       string
		provider   string
		externalID string
		want       bool
	}{
		{"no id on aws", "aws", "", true},
		{"no id on azure", "azure", "", true},
		{"no id on gcp", "gcp", "", true},
		{"id on aws", "aws", "123456789012", true},
		{"id on azure", "azure", "123456789012", false},
		{"id on gcp", "gcp", "123456789012", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validExternalAccountID(tt.provider, tt.externalID); got != tt.want {
				t.Fatalf("validExternalAccountID(%q, %q) = %v, want %v", tt.provider, tt.externalID, got, tt.want)
			}
		})
	}
}

func TestValidIdempotencyKey(t *testing.T) {
	tests := []struct {
		name string
		key  string
		want bool
	}{
		{"normal", "create-account-0001", true},
		{"max length", strings.Repeat("k", 128), true},
		{"too long", strings.Repeat("k", 129), false},
		{"empty", "", false},
		{"whitespace only", "   ", false},
		{"padded", "  key-1  ", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validIdempotencyKey(tt.key); got != tt.want {
				t.Fatalf("validIdempotencyKey(%q) = %v, want %v", tt.key, got, tt.want)
			}
		})
	}
}