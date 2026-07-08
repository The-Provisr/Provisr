package integration

import (
	"net/http"
	"testing"
	"time"
)

// TestHealthEndpoint provides the initial integration test skeleton.
// Future versions will use testcontainers-go to automatically start
// required services before executing the health check.
func TestHealthEndpoint(t *testing.T) {

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	req, err := http.NewRequest(
		http.MethodGet,
		"http://localhost:8080/health",
		nil,
	)

	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}

	resp, err := client.Do(req)

	if err != nil {
		t.Fatalf("failed to reach health endpoint: %v", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status code 200, got %d", resp.StatusCode)
	}
}
