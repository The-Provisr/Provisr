DROP INDEX IF EXISTS idx_provisioning_requests_org_created;
DROP INDEX IF EXISTS idx_provisioning_requests_status;
DROP INDEX IF EXISTS uq_provisioning_requests_idempotency;

ALTER TABLE provisioning_requests
    DROP COLUMN IF EXISTS error_message,
    DROP COLUMN IF EXISTS error_code,
    DROP COLUMN IF EXISTS correlation_id,
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS state_version;