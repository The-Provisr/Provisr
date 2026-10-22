-- BE-E01: every approval requirement evaluation is recorded in the audit chain.
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'approval_requirements_evaluated';
