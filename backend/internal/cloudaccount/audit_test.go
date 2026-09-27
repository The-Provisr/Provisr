package cloudaccount

import (
	"encoding/json"
	"testing"
)

func TestComputeAuditHashDeterministic(t *testing.T) {
	payload, err := json.Marshal(map[string]any{"provider": "aws", "label": "prod"})
	if err != nil {
		t.Fatal(err)
	}
	h1 := computeAuditHash("prev-hash", "cloud_account_created", payload, "corr-1")
	h2 := computeAuditHash("prev-hash", "cloud_account_created", payload, "corr-1")
	if h1 != h2 {
		t.Fatalf("same inputs produced different hashes: %s vs %s", h1, h2)
	}
	if len(h1) != 64 {
		t.Fatalf("expected 64 hex chars, got %d", len(h1))
	}
}

func TestComputeAuditHashChangesWithInputs(t *testing.T) {
	payload := []byte(`{"provider":"aws"}`)
	base := "prev-hash"
	event := "cloud_account_created"
	corr := "corr-1"

	cases := []struct {
		name string
		mut  func(prev, event string, payload []byte, corr string) (string, string, []byte, string)
	}{
		{
			"payload change",
			func(prev, event string, payload []byte, corr string) (string, string, []byte, string) {
				return prev, event, []byte(`{"provider":"azure"}`), corr
			},
		},
		{
			"event type change",
			func(prev, event string, payload []byte, corr string) (string, string, []byte, string) {
				return prev, "cloud_account_deleted", payload, corr
			},
		},
		{
			"correlation change",
			func(prev, event string, payload []byte, corr string) (string, string, []byte, string) {
				return prev, event, payload, "corr-2"
			},
		},
		{
			"previous hash change",
			func(prev, event string, payload []byte, corr string) (string, string, []byte, string) {
				return "other-prev", event, payload, corr
			},
		},
	}

	baseHash := computeAuditHash(base, event, payload, corr)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			prev, ev, pl, co := c.mut(base, event, payload, corr)
			got := computeAuditHash(prev, ev, pl, co)
			if got == baseHash {
				t.Fatalf("hash did not change for %s", c.name)
			}
		})
	}
}

func TestComputeAuditHashChainsToPreviousTail(t *testing.T) {
	payload := []byte(`{"provider":"aws"}`)
	tail := computeAuditHash("", "first_event", payload, "corr-1")
	chained := computeAuditHash(tail, "second_event", payload, "corr-1")
	unchained := computeAuditHash("", "second_event", payload, "corr-1")

	if chained == unchained {
		t.Fatal("appending to a tail must produce a different hash than starting a fresh chain")
	}
	if computeAuditHash(tail, "second_event", payload, "corr-1") != chained {
		t.Fatal("chained hash must be reproducible for the same tail")
	}
}