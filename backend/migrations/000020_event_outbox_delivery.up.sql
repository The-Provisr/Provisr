-- OR-019: durable, retryable SSE delivery state. Events remain replayable
-- after a publisher crash; a timed-out publishing lease becomes claimable.
ALTER TYPE provisr_events.event_status ADD VALUE IF NOT EXISTS 'publishing';

ALTER TABLE provisr_events.sse_events
    ALTER COLUMN event_id TYPE UUID USING event_id::uuid,
    ADD COLUMN published_at TIMESTAMPTZ,
    ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 3),
    ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN locked_until TIMESTAMPTZ,
    ADD COLUMN last_error TEXT,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE provisr_events.sse_events
SET published_at = created_at
WHERE status = 'sent' AND published_at IS NULL;

UPDATE provisr_events.sse_events
SET delivery_attempts = 3
WHERE status = 'failed' AND delivery_attempts < 3;

CREATE INDEX idx_sse_events_publishable
    ON provisr_events.sse_events(created_at, id)
    WHERE status = 'pending';
CREATE INDEX idx_sse_events_lease_recovery
    ON provisr_events.sse_events(locked_until, created_at)
    WHERE status = 'publishing';

GRANT USAGE ON SCHEMA provisr_events TO provisr_app;
GRANT SELECT, INSERT, UPDATE ON provisr_events.sse_events TO provisr_app;
