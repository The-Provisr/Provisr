package cloudcrypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

const ExternalIDBytes = 32

// GenerateExternalID creates a cryptographically random external ID.
// Returns (plaintext base64url, sha256 hex hash, error).
// The plaintext is shown to the user once; only the hash is stored.
func GenerateExternalID() (plaintext string, hash string, err error) {
	b := make([]byte, ExternalIDBytes)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate external id: %w", err)
	}
	plaintext = base64.RawURLEncoding.EncodeToString(b)
	hash = HashExternalIDPlain(plaintext)
	return plaintext, hash, nil
}

// HashExternalIDPlain returns the lowercase hex SHA-256 of a plaintext
// external ID. Used for verification: hash the user-provided ID and
// compare to the stored hash.
func HashExternalIDPlain(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}
