DROP TABLE IF EXISTS provisr_audit.audit_events CASCADE;

DROP TYPE IF EXISTS audit_event_type;
DROP TYPE IF EXISTS severity;
DROP TYPE IF EXISTS principal_type;

DROP SCHEMA IF EXISTS provisr_audit CASCADE;

DROP ROLE IF EXISTS audit_writer;