package manifest

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

var (
	// ErrManifestNotFound is returned when a requested manifest version does not exist.
	ErrManifestNotFound = errors.New("manifest version not found")

	// ErrInvalidRunID is returned when run_id is not a valid UUID.
	ErrInvalidRunID = errors.New("run_id must be a valid UUID")

	// ErrEmptyContent is returned when manifest content is empty or invalid.
	ErrEmptyContent = errors.New("manifest content must not be empty")
)

// ManifestRecord represents a persisted version of an infrastructure manifest.
type ManifestRecord struct {
	ID             string          `json:"id"`
	RunID          string          `json:"run_id"`
	Version        int             `json:"version"`
	Content        json.RawMessage `json:"content"`
	SourceMetadata json.RawMessage `json:"source_metadata"`
	Hash           string          `json:"hash"`
	CreatedAt      time.Time       `json:"created_at"`
}

// ManifestRecordMeta contains summary metadata for a manifest version.
type ManifestRecordMeta struct {
	ID        string    `json:"id"`
	RunID     string    `json:"run_id"`
	Version   int       `json:"version"`
	Hash      string    `json:"hash"`
	CreatedAt time.Time `json:"created_at"`
}

// Store defines operations for storing, retrieving, and listing versioned manifests.
type Store interface {
	StoreManifestVersion(ctx context.Context, runID string, content any, sourceMetadata any) (*ManifestRecord, error)
	GetManifestVersion(ctx context.Context, runID string, version int) (*ManifestRecord, error)
	GetLatestManifestVersion(ctx context.Context, runID string) (*ManifestRecord, error)
	ListManifestVersions(ctx context.Context, runID string) ([]ManifestRecordMeta, error)
}

// ComputeContentHash returns the deterministic lowercase hex SHA-256 hash of content bytes.
func ComputeContentHash(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

// DBStore implements Store backed by PostgreSQL (provisr_manifest.manifests).
type DBStore struct {
	db *sql.DB
}

// NewStore creates a new DBStore instance.
func NewStore(db *sql.DB) *DBStore {
	return &DBStore{db: db}
}

// StoreManifestVersion stores a new immutable version of a manifest for runID.
func (s *DBStore) StoreManifestVersion(ctx context.Context, runID string, content any, sourceMetadata any) (*ManifestRecord, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	contentBytes, err := normalizeContentBytes(content)
	if err != nil {
		return nil, err
	}

	hash := ComputeContentHash(contentBytes)
	metaBytes, err := normalizeMetaBytes(sourceMetadata, hash)
	if err != nil {
		return nil, err
	}

	const query = `
		WITH next_version AS (
			SELECT COALESCE(MAX(version), 0) + 1 AS ver
			FROM provisr_manifest.manifests
			WHERE run_id = $1
		)
		INSERT INTO provisr_manifest.manifests (run_id, version, content, source_metadata)
		SELECT $1, next_version.ver, $2::jsonb, $3::jsonb
		FROM next_version
		RETURNING id, run_id, version, content, source_metadata, created_at`

	var record ManifestRecord
	record.Hash = hash

	err = s.db.QueryRowContext(ctx, query, runID, string(contentBytes), string(metaBytes)).Scan(
		&record.ID,
		&record.RunID,
		&record.Version,
		&record.Content,
		&record.SourceMetadata,
		&record.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert manifest version: %w", err)
	}

	return &record, nil
}

// GetManifestVersion retrieves an exact version of a manifest for runID.
func (s *DBStore) GetManifestVersion(ctx context.Context, runID string, version int) (*ManifestRecord, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	const query = `
		SELECT id, run_id, version, content, source_metadata, created_at
		FROM provisr_manifest.manifests
		WHERE run_id = $1 AND version = $2`

	var record ManifestRecord
	err := s.db.QueryRowContext(ctx, query, runID, version).Scan(
		&record.ID,
		&record.RunID,
		&record.Version,
		&record.Content,
		&record.SourceMetadata,
		&record.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrManifestNotFound
		}
		return nil, fmt.Errorf("failed to query manifest version: %w", err)
	}

	record.Hash = extractOrComputeHash(record.Content, record.SourceMetadata)
	return &record, nil
}

// GetLatestManifestVersion retrieves the highest version manifest for runID.
func (s *DBStore) GetLatestManifestVersion(ctx context.Context, runID string) (*ManifestRecord, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	const query = `
		SELECT id, run_id, version, content, source_metadata, created_at
		FROM provisr_manifest.manifests
		WHERE run_id = $1
		ORDER BY version DESC
		LIMIT 1`

	var record ManifestRecord
	err := s.db.QueryRowContext(ctx, query, runID).Scan(
		&record.ID,
		&record.RunID,
		&record.Version,
		&record.Content,
		&record.SourceMetadata,
		&record.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrManifestNotFound
		}
		return nil, fmt.Errorf("failed to query latest manifest version: %w", err)
	}

	record.Hash = extractOrComputeHash(record.Content, record.SourceMetadata)
	return &record, nil
}

// ListManifestVersions lists metadata of all stored versions for runID.
func (s *DBStore) ListManifestVersions(ctx context.Context, runID string) ([]ManifestRecordMeta, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	const query = `
		SELECT id, run_id, version, content, source_metadata, created_at
		FROM provisr_manifest.manifests
		WHERE run_id = $1
		ORDER BY version ASC`

	rows, err := s.db.QueryContext(ctx, query, runID)
	if err != nil {
		return nil, fmt.Errorf("failed to list manifest versions: %w", err)
	}
	defer rows.Close()

	var metas []ManifestRecordMeta
	for rows.Next() {
		var id, rID string
		var ver int
		var content, srcMeta json.RawMessage
		var createdAt time.Time

		if err := rows.Scan(&id, &rID, &ver, &content, &srcMeta, &createdAt); err != nil {
			return nil, fmt.Errorf("failed to scan manifest meta: %w", err)
		}

		hash := extractOrComputeHash(content, srcMeta)
		metas = append(metas, ManifestRecordMeta{
			ID:        id,
			RunID:     rID,
			Version:   ver,
			Hash:      hash,
			CreatedAt: createdAt,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate manifest rows: %w", err)
	}

	return metas, nil
}

// MemoryStore provides a thread-safe in-memory Store implementation.
type MemoryStore struct {
	mu      sync.RWMutex
	records map[string][]ManifestRecord
}

// NewMemoryStore creates a new in-memory Store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		records: make(map[string][]ManifestRecord),
	}
}

// StoreManifestVersion stores a manifest version in memory.
func (m *MemoryStore) StoreManifestVersion(ctx context.Context, runID string, content any, sourceMetadata any) (*ManifestRecord, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	contentBytes, err := normalizeContentBytes(content)
	if err != nil {
		return nil, err
	}

	hash := ComputeContentHash(contentBytes)
	metaBytes, err := normalizeMetaBytes(sourceMetadata, hash)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	history := m.records[runID]
	nextVersion := len(history) + 1

	record := ManifestRecord{
		ID:             uuid.New().String(),
		RunID:          runID,
		Version:        nextVersion,
		Content:        json.RawMessage(contentBytes),
		SourceMetadata: json.RawMessage(metaBytes),
		Hash:           hash,
		CreatedAt:      time.Now().UTC(),
	}

	m.records[runID] = append(history, record)
	return &record, nil
}

// GetManifestVersion retrieves an exact version from memory.
func (m *MemoryStore) GetManifestVersion(ctx context.Context, runID string, version int) (*ManifestRecord, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	history := m.records[runID]
	for _, rec := range history {
		if rec.Version == version {
			return &rec, nil
		}
	}
	return nil, ErrManifestNotFound
}

// GetLatestManifestVersion retrieves the latest version from memory.
func (m *MemoryStore) GetLatestManifestVersion(ctx context.Context, runID string) (*ManifestRecord, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	history := m.records[runID]
	if len(history) == 0 {
		return nil, ErrManifestNotFound
	}

	latest := history[len(history)-1]
	return &latest, nil
}

// ListManifestVersions lists metadata of all versions in memory.
func (m *MemoryStore) ListManifestVersions(ctx context.Context, runID string) ([]ManifestRecordMeta, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrInvalidRunID
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	history := m.records[runID]
	metas := make([]ManifestRecordMeta, len(history))
	for i, rec := range history {
		metas[i] = ManifestRecordMeta{
			ID:        rec.ID,
			RunID:     rec.RunID,
			Version:   rec.Version,
			Hash:      rec.Hash,
			CreatedAt: rec.CreatedAt,
		}
	}
	return metas, nil
}

func normalizeContentBytes(content any) ([]byte, error) {
	switch v := content.(type) {
	case nil:
		return nil, ErrEmptyContent
	case []byte:
		if len(v) == 0 {
			return nil, ErrEmptyContent
		}
		if !json.Valid(v) {
			return nil, errors.New("content is not valid JSON")
		}
		return v, nil
	case json.RawMessage:
		if len(v) == 0 {
			return nil, ErrEmptyContent
		}
		if !json.Valid(v) {
			return nil, errors.New("content is not valid JSON")
		}
		return v, nil
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return nil, ErrEmptyContent
		}
		b := []byte(trimmed)
		if !json.Valid(b) {
			return nil, errors.New("content is not valid JSON")
		}
		return b, nil
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal content: %w", err)
		}
		return b, nil
	}
}

func normalizeMetaBytes(sourceMetadata any, hash string) ([]byte, error) {
	metaMap := map[string]any{}
	if sourceMetadata != nil {
		switch m := sourceMetadata.(type) {
		case map[string]any:
			for k, v := range m {
				metaMap[k] = v
			}
		case []byte:
			if len(m) > 0 {
				_ = json.Unmarshal(m, &metaMap)
			}
		case json.RawMessage:
			if len(m) > 0 {
				_ = json.Unmarshal(m, &metaMap)
			}
		default:
			b, err := json.Marshal(sourceMetadata)
			if err == nil {
				_ = json.Unmarshal(b, &metaMap)
			}
		}
	}
	metaMap["content_hash"] = hash
	return json.Marshal(metaMap)
}

func extractOrComputeHash(content json.RawMessage, srcMeta json.RawMessage) string {
	if len(srcMeta) > 0 {
		var meta map[string]any
		if err := json.Unmarshal(srcMeta, &meta); err == nil {
			if h, ok := meta["content_hash"].(string); ok && h != "" {
				return h
			}
			if h, ok := meta["hash"].(string); ok && h != "" {
				return h
			}
		}
	}
	return ComputeContentHash(content)
}
