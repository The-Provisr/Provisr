package cloudaccount

import (
	"strings"

	"github.com/google/uuid"
)

// validProvider reports whether provider is a supported cloud provider.
func validProvider(provider string) bool {
	return validProviders[provider]
}

// validStatus reports whether status is a supported account status value.
func validStatus(status string) bool {
	return validStatuses[status]
}

// validLabel reports whether label is a non-empty string of at most 255
// characters (whitespace-only labels are rejected).
func validLabel(label string) bool {
	return strings.TrimSpace(label) != "" && len(label) <= 255
}

// validWorkspaceID reports whether id parses as a UUID.
func validWorkspaceID(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

// validExternalAccountID reports whether an external_account_id is acceptable
// for the given provider: absent ids are always fine, present ids are only
// valid for aws accounts (PRD §7 delegated onboarding).
func validExternalAccountID(provider, externalAccountID string) bool {
	if externalAccountID == "" {
		return true
	}
	return provider == "aws"
}

// validIdempotencyKey reports whether key is a usable idempotency key:
// non-empty and at most 128 characters after trimming surrounding space.
func validIdempotencyKey(key string) bool {
	key = strings.TrimSpace(key)
	return key != "" && len(key) <= 128
}