-- Add columns for state machine and event publishing
ALTER TABLE provisioning_requests
    ADD COLUMN IF NOT EXISTS state_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128),
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS error_code VARCHAR(64),
    ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Unique constraint: one idempotency key per org
CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_requests_idempotency
    ON provisioning_requests(org_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Indexes for hot query paths
CREATE INDEX IF NOT EXISTS idx_provisioning_requests_status
    ON provisioning_requests(status);

CREATE INDEX IF NOT EXISTS idx_provisioning_requests_org_created
    ON provisioning_requests(org_id, created_at DESC);
