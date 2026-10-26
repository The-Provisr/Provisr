CREATE SCHEMA IF NOT EXISTS provisr_pricing;

CREATE TABLE provisr_pricing.price_cache (
    cache_key TEXT PRIMARY KEY,
    price JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_cache_expires_at
    ON provisr_pricing.price_cache (expires_at);
