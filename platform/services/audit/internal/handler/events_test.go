package handler

import (
	"testing"
	"time"

	"github.com/provisr/platform/services/audit/internal/model"
)

// TestValidateCreateEvent_Valid ensures a well-formed request passes validation.
func TestValidateCreateEvent_Valid(t *testing.T) {
	req := model.CreateEventRequest{
		OrgID:         "00000000-0000-0000-0000-000000000001",
		EventType:     "STATE_TRANSITION",
		EventSeverity: "INFO",
		ActorType:     "system",
		Action:        "transition",
		Outcome:       "success",
		SourceService: "orchestration",
	}

	errs := validateCreateEvent(req)
	if len(errs) != 0 {
		t.Fatalf("expected no errors, got %v", errs)
	}
}

// TestValidateCreateEvent_MissingRequiredFields ensures all required fields
// produce individual validation errors.
func TestValidateCreateEvent_MissingRequiredFields(t *testing.T) {
	req := model.CreateEventRequest{}
	errs := validateCreateEvent(req)

	requiredFields := map[string]bool{
		"org_id":         false,
		"event_type":     false,
		"actor_type":     false,
		"action":         false,
		"outcome":        false,
		"source_service": false,
	}

	for _, e := range errs {
		if _, ok := requiredFields[e.Field]; ok {
			requiredFields[e.Field] = true
		}
	}

	for field, found := range requiredFields {
		if !found {
			t.Errorf("expected validation error for field %q", field)
		}
	}
}

// TestValidateCreateEvent_InvalidOutcome ensures only valid outcomes pass.
func TestValidateCreateEvent_InvalidOutcome(t *testing.T) {
	req := model.CreateEventRequest{
		OrgID:         "00000000-0000-0000-0000-000000000001",
		EventType:     "STATE_TRANSITION",
		EventSeverity: "INFO",
		ActorType:     "system",
		Action:        "transition",
		Outcome:       "invalid",
		SourceService: "orchestration",
	}

	errs := validateCreateEvent(req)

	found := false
	for _, e := range errs {
		if e.Field == "outcome" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected validation error for invalid outcome")
	}
}

// TestValidateCreateEvent_ReasonRequiredOnFailure ensures the reason field
// is mandatory when outcome is 'failure' or 'denied'.
func TestValidateCreateEvent_ReasonRequiredOnFailure(t *testing.T) {
	req := model.CreateEventRequest{
		OrgID:         "00000000-0000-0000-0000-000000000001",
		EventType:     "POLICY_RESULT",
		EventSeverity: "HIGH",
		ActorType:     "system",
		Action:        "evaluate",
		Outcome:       "denied",
		SourceService: "policy",
	}

	errs := validateCreateEvent(req)

	found := false
	for _, e := range errs {
		if e.Field == "reason" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected validation error: reason required when outcome is 'denied'")
	}
}

// TestBuildCanonicalString_Deterministic ensures the same inputs produce
// the same canonical string every time.
func TestBuildCanonicalString_Deterministic(t *testing.T) {
	req := model.CreateEventRequest{
		OrgID:         "org-1",
		EventType:     "STATE_TRANSITION",
		EventSeverity: "INFO",
		ActorType:     "system",
		Action:        "transition",
		Outcome:       "success",
		Reason:        "",
		FromState:     "PENDING",
		ToState:       "LIVE",
		ToolName:      "",
		SourceService: "orchestration",
		ManifestHash:  "",
	}
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	prevHash := "abc123"

	result1 := buildCanonicalString(req, prevHash, now)
	result2 := buildCanonicalString(req, prevHash, now)

	if result1 != result2 {
		t.Fatal("canonical string is not deterministic")
	}
}

// TestBuildCanonicalString_DifferentInputs ensures different inputs produce
// different canonical strings (hash collisions are caught).
func TestBuildCanonicalString_DifferentInputs(t *testing.T) {
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)

	req1 := model.CreateEventRequest{
		OrgID:         "org-1",
		EventType:     "STATE_TRANSITION",
		EventSeverity: "INFO",
		ActorType:     "system",
		Action:        "transition",
		Outcome:       "success",
		SourceService: "orchestration",
	}

	req2 := model.CreateEventRequest{
		OrgID:         "org-1",
		EventType:     "POLICY_RESULT",
		EventSeverity: "HIGH",
		ActorType:     "system",
		Action:        "evaluate",
		Outcome:       "denied",
		Reason:        "budget exceeded",
		SourceService: "policy",
	}

	result1 := buildCanonicalString(req1, "", now)
	result2 := buildCanonicalString(req2, "", now)

	if result1 == result2 {
		t.Fatal("different events should produce different canonical strings")
	}
}

// TestSha256Hex_Length ensures the hash output is 64 hex characters (SHA-256).
func TestSha256Hex_Length(t *testing.T) {
	hash := sha256Hex("test input")
	if len(hash) != 64 {
		t.Fatalf("expected hash length 64, got %d", len(hash))
	}
}

// TestSha256Hex_Deterministic ensures same input → same hash.
func TestSha256Hex_Deterministic(t *testing.T) {
	h1 := sha256Hex("hello")
	h2 := sha256Hex("hello")
	if h1 != h2 {
		t.Fatal("sha256Hex is not deterministic")
	}
}
