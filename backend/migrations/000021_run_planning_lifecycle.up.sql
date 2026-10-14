-- OR-009..012: durable planning context, suspension and immutable draft locks.
ALTER TABLE provisr_state.provisioning_runs
    ADD COLUMN cloud_context JSONB,
    ADD COLUMN cloud_context_loaded_at TIMESTAMPTZ,
    ADD COLUMN agent_session_id UUID,
    ADD COLUMN agent_turn_pending BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN agent_input TEXT,
    ADD COLUMN current_question JSONB,
    ADD COLUMN clarification_expires_at TIMESTAMPTZ,
    ADD COLUMN answers_history JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN manifest_validation_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN manifest_validated_version INTEGER,
    ADD COLUMN manifest_confirmed_version INTEGER,
    ADD COLUMN manifest_confirmed_at TIMESTAMPTZ,
    ADD CONSTRAINT manifest_confirmation_complete CHECK (
        (manifest_confirmed_version IS NULL) = (manifest_confirmed_at IS NULL)
    ),
    ADD CONSTRAINT clarification_suspension_complete CHECK (
        (current_question IS NULL) = (clarification_expires_at IS NULL)
    ),
    ADD CONSTRAINT confirmed_manifest_is_active CHECK (
        manifest_confirmed_version IS NULL OR (
            manifest_version IS NOT NULL AND manifest_confirmed_version = manifest_version
        )
    ),
    ADD CONSTRAINT active_manifest_exists FOREIGN KEY (id, manifest_version)
        REFERENCES provisr_manifest.manifests(run_id, version) NOT VALID,
    ADD CONSTRAINT confirmed_manifest_exists FOREIGN KEY (id, manifest_confirmed_version)
        REFERENCES provisr_manifest.manifests(run_id, version) NOT VALID;

ALTER TABLE provisr_manifest.manifests ADD COLUMN idempotency_key VARCHAR(255);
CREATE UNIQUE INDEX idx_manifest_idempotency ON provisr_manifest.manifests(run_id, idempotency_key);

CREATE FUNCTION provisr_manifest.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Manifest versions are immutable';
END;
$$;
CREATE TRIGGER manifest_versions_immutable BEFORE UPDATE OR DELETE ON provisr_manifest.manifests
    FOR EACH ROW EXECUTE FUNCTION provisr_manifest.reject_mutation();

CREATE INDEX idx_run_planning_work ON provisr_state.provisioning_runs(updated_at)
    WHERE state IN ('RECEIVED', 'POLICY_LOADED', 'CLOUD_CONTEXT_LOADED', 'MANIFEST_CREATING', 'CLARIFYING');

ALTER TABLE provisr_events.sse_events ADD COLUMN stream_sequence BIGSERIAL;
CREATE UNIQUE INDEX idx_sse_workspace_sequence ON provisr_events.sse_events(workspace_id, stream_sequence);
GRANT USAGE, SELECT ON SEQUENCE provisr_events.sse_events_stream_sequence_seq TO provisr_app;
