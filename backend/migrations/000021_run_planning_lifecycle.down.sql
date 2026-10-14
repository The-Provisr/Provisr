DROP INDEX provisr_state.idx_run_planning_work;
DROP INDEX provisr_events.idx_sse_workspace_sequence;
ALTER TABLE provisr_events.sse_events DROP COLUMN stream_sequence;
DROP TRIGGER manifest_versions_immutable ON provisr_manifest.manifests;
DROP FUNCTION provisr_manifest.reject_mutation();
DROP INDEX provisr_manifest.idx_manifest_idempotency;
ALTER TABLE provisr_manifest.manifests DROP COLUMN idempotency_key;
ALTER TABLE provisr_state.provisioning_runs
    DROP CONSTRAINT manifest_confirmation_complete,
    DROP CONSTRAINT clarification_suspension_complete,
    DROP CONSTRAINT confirmed_manifest_is_active,
    DROP CONSTRAINT active_manifest_exists,
    DROP CONSTRAINT confirmed_manifest_exists,
    DROP COLUMN cloud_context, DROP COLUMN cloud_context_loaded_at,
    DROP COLUMN agent_session_id, DROP COLUMN agent_turn_pending, DROP COLUMN agent_input,
    DROP COLUMN current_question, DROP COLUMN clarification_expires_at, DROP COLUMN answers_history,
    DROP COLUMN manifest_validation_attempts, DROP COLUMN manifest_validated_version, DROP COLUMN manifest_confirmed_version,
    DROP COLUMN manifest_confirmed_at;
