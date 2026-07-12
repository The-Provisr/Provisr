package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// Config holds PostgreSQL connection parameters.
// Matches the "database" section of config.json.
type Config struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Name     string `json:"name"`
	User     string `json:"user"`
	Password string `json:"password"`
	SSLMode  string `json:"sslmode"`
}

// ConnString builds a PostgreSQL connection URI from the config.
func (c Config) ConnString() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		c.User, c.Password, c.Host, c.Port, c.Name, c.SSLMode,
	)
}

// NewPool initializes a pgxpool connection pool.
// It applies sensible defaults:
//   - MaxConns: 10 (enough for a single service; tune up if needed)
//   - MinConns: 2 (keep 2 warm to avoid cold-start latency)
//   - MaxConnLifetime: 30 min (rotate connections to avoid stale TCP)
//   - HealthCheckPeriod: 1 min (background ping to detect dead conns)
func NewPool(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	connStr := cfg.ConnString()

	poolCfg, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("unable to parse pool config: %w", err)
	}

	poolCfg.MaxConns = 10
	poolCfg.MinConns = 2
	poolCfg.MaxConnLifetime = 30 * time.Minute
	poolCfg.HealthCheckPeriod = 1 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	// Verify the connection works before returning.
	// Without this, a misconfigured DB URL would only be caught
	// on the first HTTP request.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	log.Info().
		Str("host", cfg.Host).
		Int("port", cfg.Port).
		Str("database", cfg.Name).
		Str("user", cfg.User).
		Msg("Connected to PostgreSQL")

	return pool, nil
}
