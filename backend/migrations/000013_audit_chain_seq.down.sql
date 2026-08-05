DROP INDEX IF EXISTS provisr_audit.idx_audit_events_seq;
ALTER TABLE provisr_audit.audit_events DROP COLUMN seq;
