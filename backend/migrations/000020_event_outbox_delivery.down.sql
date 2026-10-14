REVOKE SELECT, INSERT, UPDATE ON provisr_events.sse_events FROM provisr_app;
REVOKE USAGE ON SCHEMA provisr_events FROM provisr_app;
DROP INDEX IF EXISTS provisr_events.idx_sse_events_lease_recovery;
DROP INDEX IF EXISTS provisr_events.idx_sse_events_publishable;
ALTER TABLE provisr_events.sse_events
    ALTER COLUMN event_id TYPE VARCHAR(128) USING event_id::text,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS last_error,
    DROP COLUMN IF EXISTS locked_until,
    DROP COLUMN IF EXISTS next_attempt_at,
    DROP COLUMN IF EXISTS delivery_attempts,
    DROP COLUMN IF EXISTS published_at;
