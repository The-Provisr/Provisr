CREATE SCHEMA IF NOT EXISTS provisr_manifest;

CREATE TABLE provisr_manifest.manifests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES provisr_state.provisioning_runs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content JSONB NOT NULL,
    source_metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, version)
);

CREATE INDEX idx_manifests_run_id ON provisr_manifest.manifests(run_id);
