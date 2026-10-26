-- OR-013. Generation evidence is owned by BE-D04 (000022) at deployment.
ALTER TABLE provisr_state.provisioning_runs
    ADD COLUMN iac_artifact_id UUID REFERENCES provisr_iac.artifacts(id) ON DELETE RESTRICT;

DROP INDEX provisr_state.idx_run_planning_work;
CREATE INDEX idx_run_planning_work ON provisr_state.provisioning_runs(updated_at)
    WHERE state IN ('RECEIVED', 'POLICY_LOADED', 'CLOUD_CONTEXT_LOADED', 'MANIFEST_CREATING', 'CLARIFYING', 'IAC_GENERATING');
