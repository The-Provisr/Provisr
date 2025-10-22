package pricing

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type PostgresCacheStore struct{ DB *sql.DB }

func (s PostgresCacheStore) Get(ctx context.Context, key string) (cacheEntry, bool, error) {
	var raw []byte
	var expiresAt time.Time
	err := s.DB.QueryRowContext(ctx,
		`SELECT price, expires_at FROM provisr_pricing.price_cache WHERE cache_key = $1`, key,
	).Scan(&raw, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return cacheEntry{}, false, nil
	}
	if err != nil {
		return cacheEntry{}, false, err
	}
	var price Price
	if err := json.Unmarshal(raw, &price); err != nil {
		return cacheEntry{}, false, err
	}
	return cacheEntry{price: price, expiresAt: expiresAt}, true, nil
}

func (s PostgresCacheStore) Put(ctx context.Context, key string, entry cacheEntry) error {
	raw, err := json.Marshal(entry.price)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `
		INSERT INTO provisr_pricing.price_cache (cache_key, price, expires_at)
		VALUES ($1, $2::jsonb, $3)
		ON CONFLICT (cache_key) DO UPDATE
		SET price = EXCLUDED.price, expires_at = EXCLUDED.expires_at, updated_at = now()`,
		key, string(raw), entry.expiresAt,
	)
	return err
}
