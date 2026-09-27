package cloudaccount

import (
	"crypto/sha256"
	"encoding/hex"
)

// computeAuditHash binds an audit event to the previous tail of the chain and
// to its correlation id: SHA-256 over previous-hash, event type, payload, and
// correlation id. Any change to a predecessor invalidates the whole chain.
func computeAuditHash(previousHash, eventType string, payload []byte, correlationID string) string {
	sum := sha256.New()
	sum.Write([]byte(previousHash))
	sum.Write([]byte(eventType))
	sum.Write(payload)
	sum.Write([]byte(correlationID))
	return hex.EncodeToString(sum.Sum(nil))
}