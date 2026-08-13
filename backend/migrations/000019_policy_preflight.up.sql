-- OR-008: retain the exact policy snapshot used to create a manifest.
ALTER TABLE provisr_state.provisioning_runs
    ADD COLUMN policy_requirements JSONB,
    ADD COLUMN policy_requirements_loaded_at TIMESTAMPTZ;

ALTER TABLE provisr_state.provisioning_runs
    ADD CONSTRAINT policy_requirements_snapshot_complete CHECK (
        policy_requirements IS NULL OR (
            policy_requirements ? 'allowed_regions'
            AND policy_requirements ? 'max_budget'
            AND policy_requirements ? 'required_tags'
            AND policy_requirements ? 'prohibited_resource_types'
            AND policy_requirements ? 'required_encryption'
            AND policy_requirements ? 'required_backup'
        )
    );

CREATE INDEX idx_provisioning_runs_policy_requirements_loaded
    ON provisr_state.provisioning_runs(policy_requirements_loaded_at)
    WHERE policy_requirements_loaded_at IS NOT NULL;

ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'policy_preflight_loaded';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'policy_preflight_skipped';
