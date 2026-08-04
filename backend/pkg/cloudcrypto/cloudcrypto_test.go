package cloudcrypto

import (
	"bytes"
	"strings"
	"testing"
)

const testMasterHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestParseMasterKey(t *testing.T) {
	key, err := ParseMasterKey(testMasterHex)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("expected 32-byte key, got %d", len(key))
	}
}

func TestParseMasterKeyRejectsShortKey(t *testing.T) {
	if _, err := ParseMasterKey("abc"); err == nil {
		t.Fatal("expected error for short key")
	}
}

func TestParseMasterKeyRejectsNonHex(t *testing.T) {
	if _, err := ParseMasterKey(strings.Repeat("z", 64)); err == nil {
		t.Fatal("expected error for non-hex key")
	}
}

func TestDeriveWorkspaceKeyIsDeterministicAndPerWorkspace(t *testing.T) {
	master, err := ParseMasterKey(testMasterHex)
	if err != nil {
		t.Fatal(err)
	}
	keyA1, _ := DeriveWorkspaceKey(master, "ws-1")
	keyA2, _ := DeriveWorkspaceKey(master, "ws-1")
	keyB, _ := DeriveWorkspaceKey(master, "ws-2")

	if !bytes.Equal(keyA1, keyA2) {
		t.Fatal("same workspace must derive the same key")
	}
	if len(keyA1) != 32 {
		t.Fatalf("expected 32-byte workspace key, got %d", len(keyA1))
	}
	if bytes.Equal(keyA1, keyB) {
		t.Fatal("different workspaces must derive different keys")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	master, _ := ParseMasterKey(testMasterHex)
	key, _ := DeriveWorkspaceKey(master, "ws-1")

	payload := map[string]any{"role_arn": "arn:aws:iam::123456789012:role/x", "tenant_id": "abc"}
	blob, err := EncryptJSON(key, payload)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if blob == "" {
		t.Fatal("expected non-empty blob")
	}

	var decrypted map[string]any
	if err := DecryptJSON(key, blob, &decrypted); err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if decrypted["role_arn"] != payload["role_arn"] || decrypted["tenant_id"] != payload["tenant_id"] {
		t.Fatalf("round trip mismatch: %v", decrypted)
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	master, _ := ParseMasterKey(testMasterHex)
	keyA, _ := DeriveWorkspaceKey(master, "ws-1")
	keyB, _ := DeriveWorkspaceKey(master, "ws-2")

	blob, err := EncryptJSON(keyA, map[string]any{"role_arn": "arn:aws:iam::1:role/x"})
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := DecryptJSON(keyB, blob, &out); err == nil {
		t.Fatal("expected error decrypting with a different workspace key")
	}
}

func TestDecryptRejectsTamperedBlob(t *testing.T) {
	master, _ := ParseMasterKey(testMasterHex)
	key, _ := DeriveWorkspaceKey(master, "ws-1")

	blob, err := EncryptJSON(key, map[string]any{"role_arn": "x"})
	if err != nil {
		t.Fatal(err)
	}
	tampered := blob[:len(blob)-4] + "AAAA"
	var out map[string]any
	if err := DecryptJSON(key, tampered, &out); err == nil {
		t.Fatal("expected error for tampered blob")
	}
}

func TestHashExternalIDIsDeterministicAndSecret(t *testing.T) {
	master, _ := ParseMasterKey(testMasterHex)
	keyA, _ := DeriveWorkspaceKey(master, "ws-1")
	keyB, _ := DeriveWorkspaceKey(master, "ws-2")

	hashA1, err := HashExternalID(keyA, "123456789012")
	if err != nil {
		t.Fatal(err)
	}
	hashA2, _ := HashExternalID(keyA, "123456789012")
	hashB, _ := HashExternalID(keyB, "123456789012")

	if hashA1 != hashA2 {
		t.Fatal("same id under same key must hash identically")
	}
	if len(hashA1) != 64 {
		t.Fatalf("expected 64 hex chars, got %d", len(hashA1))
	}
	if hashA1 == hashB {
		t.Fatal("same id under different keys must hash differently")
	}
	if strings.Contains(hashA1, "123456789012") {
		t.Fatal("hash must not leak the plaintext id")
	}
}
