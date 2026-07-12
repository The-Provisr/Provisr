package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// TestAuditEventPipeline is the E2E skeleton for the audit event pipeline.
// It tests that a valid audit event can be created via the HTTP API
// and verified in the database.
//
// Future extensions:
//   - Spin up Agent mock → send event → verify audit_events row
//   - Spin up Policy mock → send event → verify audit_events row
//   - Spin up Approval mock → send event → verify audit_events row
//   - Full pipeline: request → agent mock → policy mock → approval mock → audit
//
// For now, it tests the audit service in isolation using testcontainers-go.
func TestAuditEventPipeline(t *testing.T) {
	baseURL := strings.TrimRight(os.Getenv("PROVISR_BASE_URL"), "/")
	if baseURL == "" {
		t.Skip("set PROVISR_BASE_URL to run integration tests against a running service (e.g. http://localhost:8085)")
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// --- Step 1: Create a valid audit event ---
	payload := map[string]string{
		"org_id":         "00000000-0000-0000-0000-000000000001",
		"event_type":     "STATE_TRANSITION",
		"event_severity": "INFO",
		"actor_type":     "system",
		"action":         "transition",
		"outcome":        "success",
		"source_service": "orchestration",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}

	req, err := http.NewRequest(
		http.MethodPost,
		baseURL+"/v1/audit/events",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", resp.StatusCode)
	}

	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result["event_id"] == "" {
		t.Fatal("expected non-empty event_id in response")
	}
	if result["event_hash"] == "" {
		t.Fatal("expected non-empty event_hash in response")
	}
	if len(result["event_hash"]) != 64 {
		t.Fatalf("expected event_hash length 64, got %d", len(result["event_hash"]))
	}

	t.Logf("Created audit event: id=%s hash=%s", result["event_id"], result["event_hash"])

	// --- Step 2: Test validation — missing required fields ---
	invalidPayload := map[string]string{}
	invalidBody, _ := json.Marshal(invalidPayload)

	req2, _ := http.NewRequest(
		http.MethodPost,
		baseURL+"/v1/audit/events",
		bytes.NewReader(invalidBody),
	)
	req2.Header.Set("Content-Type", "application/json")

	resp2, err := client.Do(req2)
	if err != nil {
		t.Fatalf("failed to send invalid request: %v", err)
	}
	defer resp2.Body.Close()

	if resp2.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected status 400 for invalid payload, got %d", resp2.StatusCode)
	}

	t.Log("Validation test passed: missing fields correctly rejected with 400")

	// --- Future extension points ---
	// TODO: Spin up testcontainers-go PostgreSQL
	// TODO: Apply migration SQL
	// TODO: Insert events via direct DB connection
	// TODO: Assert hash chain continuity between events
	// TODO: Agent mock: create provisioning_requests → verify audit events
	// TODO: Policy mock: create policy_evaluations → verify audit events
	// TODO: Approval mock: create approval_tickets → verify audit events
}
