package integration

import (
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// TestHealthEndpoint provides the initial integration test skeleton.
// Future versions will use testcontainers-go to automatically start
// required services before executing the health check.
func TestHealthEndpoint(t *testing.T) {
	baseURL := strings.TrimRight(os.Getenv("PROVISR_BASE_URL"), "/")
	if baseURL == "" {
		t.Skip("set PROVISR_BASE_URL to run integration tests against a running service (e.g. http://localhost:8080)")
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	req, err := http.NewRequest(
		http.MethodGet,
		baseURL+"/health",
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
