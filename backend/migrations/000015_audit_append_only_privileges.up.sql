-- Enforce append-only immutability on provisr_audit.audit_events at the database engine level.
CREATE OR REPLACE FUNCTION provisr_audit.prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'provisr_audit.audit_events is append-only: % operations are strictly forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_provisr_audit_prevent_tampering
BEFORE UPDATE OR DELETE ON provisr_audit.audit_events
FOR EACH ROW EXECUTE FUNCTION provisr_audit.prevent_audit_tampering();
