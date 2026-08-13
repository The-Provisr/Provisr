DROP INDEX IF EXISTS provisr_events.idx_sse_events_lease_recovery;
DROP INDEX IF EXISTS provisr_events.idx_sse_events_publishable;
ALTER TABLE provisr_events.sse_events
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS last_error,
    DROP COLUMN IF EXISTS locked_until,
    DROP COLUMN IF EXISTS next_attempt_at,
    DROP COLUMN IF EXISTS delivery_attempts,
    DROP COLUMN IF EXISTS published_at;
