package cloudcrypto

import "testing"

func TestGenerateExternalID(t *testing.T) {
	plain1, hash1, err := GenerateExternalID()
	if err != nil {
		t.Fatalf("GenerateExternalID: %v", err)
	}
	if plain1 == "" || hash1 == "" {
		t.Fatal("expected non-empty plaintext and hash")
	}
	if len(hash1) != 64 {
		t.Fatalf("expected 64-char hex hash, got %d", len(hash1))
	}

	// Uniqueness
	plain2, hash2, err := GenerateExternalID()
	if err != nil {
		t.Fatalf("GenerateExternalID: %v", err)
	}
	if plain1 == plain2 {
		t.Error("two generated IDs should not be equal")
	}
	if hash1 == hash2 {
		t.Error("two generated hashes should not be equal")
	}
}

func TestHashExternalIDPlain(t *testing.T) {
	plain, hash, err := GenerateExternalID()
	if err != nil {
		t.Fatalf("GenerateExternalID: %v", err)
	}
	// Verify round-trip
	got := HashExternalIDPlain(plain)
	if got != hash {
		t.Errorf("HashExternalIDPlain mismatch: got %s, want %s", got, hash)
	}
	// Wrong input should not match
	wrong := HashExternalIDPlain("wrong-id")
	if wrong == hash {
		t.Error("wrong plaintext should not produce matching hash")
	}
}
