DROP INDEX IF EXISTS provisr_state.idx_provisioning_runs_policy_requirements_loaded;
ALTER TABLE provisr_state.provisioning_runs
    DROP CONSTRAINT IF EXISTS policy_requirements_snapshot_complete,
    DROP COLUMN IF EXISTS policy_requirements_loaded_at,
    DROP COLUMN IF EXISTS policy_requirements;
