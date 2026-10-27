-- BE-D06: findings from secret scanning are audited as secret_detected.
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'secret_detected';
