-- BE-B01 review: give the audit hash chain a monotonic tail-ordering key.
-- Appends are serialized in the service with a transaction-scoped advisory
-- lock, so the chain cannot fork under concurrent mutations; the seq column
-- replaces created_at/hash ordering when reading the chain tail.

ALTER TABLE provisr_audit.audit_events
    ADD COLUMN seq BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE INDEX idx_audit_events_seq ON provisr_audit.audit_events(seq);
