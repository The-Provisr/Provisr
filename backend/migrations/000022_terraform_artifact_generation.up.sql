-- BE-D04: persist individual Terraform files atomically with artifact metadata.
ALTER TABLE provisr_iac.artifacts
    ADD COLUMN manifest_id UUID REFERENCES provisr_manifest.manifests(id) ON DELETE RESTRICT,
    ADD COLUMN idempotency_key VARCHAR(255),
    ADD COLUMN generation JSONB,
    ADD CONSTRAINT terraform_generation_complete CHECK (
        (generation IS NULL AND manifest_id IS NULL AND idempotency_key IS NULL) OR
        (type = 'terraform' AND generation IS NOT NULL AND manifest_id IS NOT NULL AND idempotency_key IS NOT NULL)
    );
CREATE UNIQUE INDEX idx_iac_generation_key ON provisr_iac.artifacts(run_id,idempotency_key);
CREATE UNIQUE INDEX idx_iac_manifest_generation ON provisr_iac.artifacts(run_id,manifest_id) WHERE type='terraform';
CREATE TRIGGER terraform_artifacts_immutable BEFORE UPDATE OR DELETE ON provisr_iac.artifacts
    FOR EACH ROW WHEN (OLD.generation IS NOT NULL) EXECUTE FUNCTION provisr_manifest.reject_mutation();
GRANT USAGE ON SCHEMA provisr_iac, provisr_manifest TO provisr_app;
GRANT USAGE ON TYPE provisr_iac.artifact_type TO provisr_app;
GRANT SELECT ON provisr_manifest.manifests TO provisr_app;
GRANT SELECT, INSERT ON provisr_iac.artifacts TO provisr_app;
-- PostgreSQL requires UPDATE privilege on at least one column for row locking.
-- Generation only reads/locks this row; it never advances the workflow state.
GRANT UPDATE (state_version) ON provisr_state.provisioning_runs TO provisr_app;
