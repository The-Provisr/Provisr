DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM provisr_state.provisioning_runs WHERE iac_artifact_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot discard persisted IaC run links';
    END IF;
END $$;
ALTER TABLE provisr_state.provisioning_runs DROP COLUMN iac_artifact_id;
DROP INDEX provisr_state.idx_run_planning_work;
CREATE INDEX idx_run_planning_work ON provisr_state.provisioning_runs(updated_at)
    WHERE state IN ('RECEIVED', 'POLICY_LOADED', 'CLOUD_CONTEXT_LOADED', 'MANIFEST_CREATING', 'CLARIFYING');
