-- BE-D05: private immutable plans; raw/binary content is application encrypted.
CREATE TABLE provisr_iac.plans (
    artifact_id UUID PRIMARY KEY REFERENCES provisr_iac.artifacts(id) ON DELETE RESTRICT,
    run_id UUID NOT NULL REFERENCES provisr_state.provisioning_runs(id) ON DELETE RESTRICT,
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE RESTRICT,
    iac_artifact_id UUID NOT NULL REFERENCES provisr_iac.artifacts(id) ON DELETE RESTRICT,
    manifest_id UUID NOT NULL REFERENCES provisr_manifest.manifests(id) ON DELETE RESTRICT,
    manifest_version INT NOT NULL CHECK (manifest_version > 0),
    idempotency_key VARCHAR(255) NOT NULL CHECK (length(trim(idempotency_key)) > 0),
    response JSONB NOT NULL,
    encrypted_plan TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(run_id,idempotency_key)
);
CREATE TRIGGER plans_immutable BEFORE UPDATE OR DELETE ON provisr_iac.plans
    FOR EACH ROW EXECUTE FUNCTION provisr_manifest.reject_mutation();
CREATE TRIGGER plan_artifacts_immutable BEFORE UPDATE OR DELETE ON provisr_iac.artifacts
    FOR EACH ROW WHEN (OLD.type = 'plan') EXECUTE FUNCTION provisr_manifest.reject_mutation();
GRANT SELECT, INSERT ON provisr_iac.plans TO provisr_app;
REVOKE UPDATE, DELETE, TRUNCATE ON provisr_iac.plans FROM provisr_app;
