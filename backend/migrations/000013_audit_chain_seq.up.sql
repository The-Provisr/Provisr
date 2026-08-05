-- BE-B01 review: give the audit hash chain a monotonic tail-ordering key.
-- Appends are serialized in the service with a transaction-scoped advisory
-- lock, so the chain cannot fork under concurrent mutations; the seq column
-- replaces created_at/hash ordering when reading the chain tail.
--
-- The backfill is explicit: PostgreSQL fills an added identity column in
-- physical (non-deterministic) row order, which would not reproduce the
-- legacy tail ordering. Assigning row_number by (created_at ASC, hash DESC)
-- gives the former tail (newest created_at, lowest hash on ties — the old
-- ORDER BY created_at DESC, hash) the highest seq, so ORDER BY seq DESC picks
-- the same tail the old query did.

ALTER TABLE provisr_audit.audit_events
    ADD COLUMN seq BIGINT;

UPDATE provisr_audit.audit_events a
SET seq = t.rn
FROM (
    SELECT id, row_number() OVER (ORDER BY created_at ASC, hash DESC) AS rn
    FROM provisr_audit.audit_events
) t
WHERE a.id = t.id;

ALTER TABLE provisr_audit.audit_events
    ALTER COLUMN seq SET NOT NULL,
    ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY;

-- Advance the identity sequence beyond the highest backfilled value.
SELECT setval(
    pg_get_serial_sequence('provisr_audit.audit_events', 'seq'),
    (SELECT max(seq) FROM provisr_audit.audit_events)
);

CREATE INDEX idx_audit_events_seq ON provisr_audit.audit_events(seq);
