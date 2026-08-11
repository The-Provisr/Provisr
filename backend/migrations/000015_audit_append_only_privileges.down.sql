DROP TRIGGER IF EXISTS trg_provisr_audit_prevent_tampering ON provisr_audit.audit_events;
DROP FUNCTION IF EXISTS provisr_audit.prevent_audit_tampering();
