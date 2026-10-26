package manifest

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/google/uuid"
)

func TestComputeContentHash(t *testing.T) {
	content1 := []byte(`{"resources":[{"id":"s3_1"}]}`)
	content2 := []byte(`{"resources":[{"id":"s3_1"}]}`)
	content3 := []byte(`{"resources":[{"id":"s3_2"}]}`)

	h1 := ComputeContentHash(content1)
	h2 := ComputeContentHash(content2)
	h3 := ComputeContentHash(content3)

	if h1 != h2 {
		t.Fatalf("expected identical hashes for identical content, got %q != %q", h1, h2)
	}
	if h1 == h3 {
		t.Fatalf("expected different hashes for different content, got identical %q", h1)
	}
	if len(h1) != 64 {
		t.Fatalf("expected 64 hex characters for SHA-256 hash, got %d (%q)", len(h1), h1)
	}
}

func TestMemoryStore_Lifecycle(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	runID := uuid.New().String()

	// 1. Initial Get on empty run should return ErrManifestNotFound
	_, err := store.GetLatestManifestVersion(ctx, runID)
	if err != ErrManifestNotFound {
		t.Fatalf("expected ErrManifestNotFound, got %v", err)
	}

	// 2. Store Version 1
	v1Content := map[string]any{"version": "1.0", "resources": []any{"bucket_a"}}
	rec1, err := store.StoreManifestVersion(ctx, runID, v1Content, map[string]any{"source": "user_prompt"})
	if err != nil {
		t.Fatalf("failed to store v1: %v", err)
	}
	if rec1.Version != 1 {
		t.Fatalf("expected version 1, got %d", rec1.Version)
	}
	if rec1.RunID != runID {
		t.Fatalf("expected runID %s, got %s", runID, rec1.RunID)
	}
	if rec1.Hash == "" {
		t.Fatal("expected non-empty content hash")
	}

	// 3. Store Version 2
	v2Content := map[string]any{"version": "1.0", "resources": []any{"bucket_a", "db_b"}}
	rec2, err := store.StoreManifestVersion(ctx, runID, v2Content, map[string]any{"source": "policy_default"})
	if err != nil {
		t.Fatalf("failed to store v2: %v", err)
	}
	if rec2.Version != 2 {
		t.Fatalf("expected version 2, got %d", rec2.Version)
	}
	if rec2.Hash == rec1.Hash {
		t.Fatal("expected v2 hash to differ from v1 hash")
	}

	// 4. Store Version 3
	v3Content := map[string]any{"version": "1.0", "resources": []any{"bucket_a", "db_b", "queue_c"}}
	rec3, err := store.StoreManifestVersion(ctx, runID, v3Content, nil)
	if err != nil {
		t.Fatalf("failed to store v3: %v", err)
	}
	if rec3.Version != 3 {
		t.Fatalf("expected version 3, got %d", rec3.Version)
	}

	// 5. Get Latest should return Version 3
	latest, err := store.GetLatestManifestVersion(ctx, runID)
	if err != nil {
		t.Fatalf("failed to get latest version: %v", err)
	}
	if latest.Version != 3 {
		t.Fatalf("expected latest version 3, got %d", latest.Version)
	}
	if latest.Hash != rec3.Hash {
		t.Fatalf("expected hash %q, got %q", rec3.Hash, latest.Hash)
	}

	// 6. Get Specific Version 2
	v2Record, err := store.GetManifestVersion(ctx, runID, 2)
	if err != nil {
		t.Fatalf("failed to get version 2: %v", err)
	}
	if v2Record.Version != 2 {
		t.Fatalf("expected version 2, got %d", v2Record.Version)
	}
	if v2Record.Hash != rec2.Hash {
		t.Fatalf("expected hash %q, got %q", rec2.Hash, v2Record.Hash)
	}

	// 7. Get non-existent version 99
	_, err = store.GetManifestVersion(ctx, runID, 99)
	if err != ErrManifestNotFound {
		t.Fatalf("expected ErrManifestNotFound, got %v", err)
	}

	// 8. List Manifest Versions
	list, err := store.ListManifestVersions(ctx, runID)
	if err != nil {
		t.Fatalf("failed to list versions: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3 version records, got %d", len(list))
	}
	for i, meta := range list {
		expectedVer := i + 1
		if meta.Version != expectedVer {
			t.Fatalf("list item %d: expected version %d, got %d", i, expectedVer, meta.Version)
		}
		if meta.Hash == "" {
			t.Fatalf("list item %d: expected non-empty hash", i)
		}
	}
}

func TestMemoryStore_InputValidation(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	// 1. Invalid Run ID
	_, err := store.StoreManifestVersion(ctx, "not-a-uuid", map[string]any{"a": 1}, nil)
	if err != ErrInvalidRunID {
		t.Fatalf("expected ErrInvalidRunID, got %v", err)
	}

	validRunID := uuid.New().String()

	// 2. Empty nil content
	_, err = store.StoreManifestVersion(ctx, validRunID, nil, nil)
	if err != ErrEmptyContent {
		t.Fatalf("expected ErrEmptyContent for nil content, got %v", err)
	}

	// 3. Empty string content
	_, err = store.StoreManifestVersion(ctx, validRunID, "   ", nil)
	if err != ErrEmptyContent {
		t.Fatalf("expected ErrEmptyContent for empty string, got %v", err)
	}

	// 4. Invalid JSON string
	_, err = store.StoreManifestVersion(ctx, validRunID, "{not-json}", nil)
	if err == nil {
		t.Fatal("expected error for invalid JSON string")
	}

	// 5. Valid raw JSON string
	rec, err := store.StoreManifestVersion(ctx, validRunID, `{"status":"ok"}`, nil)
	if err != nil {
		t.Fatalf("unexpected error for valid JSON string: %v", err)
	}
	if rec.Version != 1 {
		t.Fatalf("expected version 1, got %d", rec.Version)
	}

	// 6. Valid json.RawMessage
	recRaw, err := store.StoreManifestVersion(ctx, validRunID, json.RawMessage(`{"status":"updated"}`), nil)
	if err != nil {
		t.Fatalf("unexpected error for json.RawMessage: %v", err)
	}
	if recRaw.Version != 2 {
		t.Fatalf("expected version 2, got %d", recRaw.Version)
	}
}

func TestMemoryStore_ConcurrentWrites(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	const numRuns = 10
	const versionsPerRun = 20

	var wg sync.WaitGroup
	wg.Add(numRuns)

	for r := 0; r < numRuns; r++ {
		go func() {
			defer wg.Done()
			runID := uuid.New().String()
			for v := 1; v <= versionsPerRun; v++ {
				content := map[string]any{"v": v}
				rec, err := store.StoreManifestVersion(ctx, runID, content, nil)
				if err != nil {
					t.Errorf("concurrent store failed: %v", err)
					return
				}
				if rec.Version != v {
					t.Errorf("expected version %d, got %d", v, rec.Version)
					return
				}
			}
		}()
	}

	wg.Wait()
}
