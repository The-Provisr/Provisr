// Package cloudcrypto implements AES-256-GCM encryption of cloud account
// metadata with workspace-scoped keys derived from a master key, and HMAC
// hashing of external account ids for lookup without decryption.
package cloudcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	// MasterKeyHexLen is the length of a 256-bit master key in hex characters.
	MasterKeyHexLen = 64
	// NonceSize is the AES-GCM standard nonce size.
	NonceSize = 12
)

// MasterKey is a parsed 256-bit master key.
type MasterKey []byte

// ParseMasterKey decodes a 64-character hex master key. Surrounding
// whitespace is trimmed first: secrets injected from env files and CI vars
// commonly carry a trailing newline.
func ParseMasterKey(hexValue string) (MasterKey, error) {
	hexValue = strings.TrimSpace(hexValue)
	if len(hexValue) != MasterKeyHexLen {
		return nil, fmt.Errorf("master key must be %d hex characters", MasterKeyHexLen)
	}
	decoded, err := hex.DecodeString(hexValue)
	if err != nil {
		return nil, fmt.Errorf("master key is not valid hex: %w", err)
	}
	return MasterKey(decoded), nil
}

// DeriveWorkspaceKey returns a 32-byte AES key for a workspace, derived from
// the master key via HMAC-SHA256 so each workspace has an independent key.
func DeriveWorkspaceKey(master MasterKey, workspaceID string) ([]byte, error) {
	if len(workspaceID) == 0 {
		return nil, errors.New("workspace id must not be empty")
	}
	mac := hmac.New(sha256.New, master)
	mac.Write([]byte("cloud-account:v1:" + workspaceID))
	return mac.Sum(nil), nil
}

// EncryptJSON serializes payload and encrypts it with AES-256-GCM.
// The result is base64(nonce || ciphertext).
func EncryptJSON(key []byte, payload any) (string, error) {
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}
	nonce := make([]byte, NonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("new gcm: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	blob := make([]byte, 0, NonceSize+len(sealed))
	blob = append(blob, nonce...)
	blob = append(blob, sealed...)
	return base64.StdEncoding.EncodeToString(blob), nil
}

// DecryptJSON reverses EncryptJSON.
func DecryptJSON(key []byte, encoded string, target any) error {
	blob, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("decode blob: %w", err)
	}
	if len(blob) < NonceSize {
		return errors.New("encrypted blob too short")
	}
	nonce, sealed := blob[:NonceSize], blob[NonceSize:]
	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("new gcm: %w", err)
	}
	plaintext, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return fmt.Errorf("decrypt blob: %w", err)
	}
	if err := json.Unmarshal(plaintext, target); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}
	return nil
}

// HashExternalID returns the lowercase hex HMAC-SHA256 of the external
// account id under the workspace key. It is used for exact-match lookups
// without ever storing or exposing the plaintext id.
func HashExternalID(key []byte, externalID string) (string, error) {
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return "", errors.New("external account id must not be empty")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("external-id:" + externalID))
	return hex.EncodeToString(mac.Sum(nil)), nil
}
