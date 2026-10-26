package manifest

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"testing"
)

func TestSemanticIdempotentReplay(t *testing.T) {
	s := NewMemoryStore()
	run := uuid.NewString()
	a, err := s.StoreManifestVersionWithKey(context.Background(), run, "retry", json.RawMessage(`{"b":2,"a":9007199254740993}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.StoreManifestVersionWithKey(context.Background(), run, "retry", json.RawMessage(`{ "a": 9007199254740993, "b": 2 }`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != b.ID {
		t.Fatal("replay created another version")
	}
	_, err = s.StoreManifestVersionWithKey(context.Background(), run, "retry", json.RawMessage(`{"a":9007199254740992,"b":2}`), nil)
	if err != ErrIdempotencyConflict {
		t.Fatal("distinct large integers must conflict")
	}
}
