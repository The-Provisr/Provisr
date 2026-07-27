CREATE SCHEMA IF NOT EXISTS provisr_iac;

CREATE TYPE provisr_iac.artifact_type AS ENUM ('terraform', 'plan', 'cost_estimate', 'policy_result', 'log');

CREATE TABLE provisr_iac.artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES provisr_state.provisioning_runs(id) ON DELETE CASCADE,
    type provisr_iac.artifact_type NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artifacts_run_id ON provisr_iac.artifacts(run_id);
CREATE INDEX idx_artifacts_type ON provisr_iac.artifacts(type);
