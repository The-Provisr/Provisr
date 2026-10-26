package statebackend

import (
	"context"

	"github.com/provisr/backend/internal/cloudaccount"
)

// Target is internal-only: Account carries decrypted delegated identity.
type Target struct {
	WorkspaceID string
	Account     cloudaccount.CapabilityAccount
	// Existing is the previously recorded settings, zero on first run.
	Existing Settings
}

// Outcome reports what the driver had to do to make the backend usable.
type Outcome struct {
	Settings Settings
	Created  bool
	Repaired bool
}

// Driver verifies the provider-native state backend, creating it on first run.
type Driver interface {
	Ensure(context.Context, Target) (Outcome, error)
}

// Failure messages are generic; provider error text never reaches callers.
type Failure struct {
	Status  int    `json:"-"`
	Code    string `json:"error"`
	Message string `json:"message"`
}

func (e *Failure) Error() string { return e.Message }

var (
	errUnavailable = &Failure{Status: 502, Code: "backend_unavailable", Message: "Remote state backend is not accessible"}
	errConflict    = &Failure{Status: 409, Code: "backend_conflict", Message: "Remote state backend name is held by another owner"}
	errNotOnboard  = &Failure{Status: 422, Code: "provider_not_onboarded", Message: "Remote state is unavailable until delegated onboarding exists for this provider"}
)

// unonboarded keeps Azure/GCP fail closed until their delegated onboarding
// lands; AzureSettings/GCPSettings already define the backend they will use.
type unonboarded struct{}

func (unonboarded) Ensure(context.Context, Target) (Outcome, error) { return Outcome{}, errNotOnboard }
