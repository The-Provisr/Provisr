-- OR-006: replace the provisional run labels with the PRD §9 canonical FSM.
-- A separate type makes the migration safe for existing rows and avoids a
-- destructive table rebuild.
CREATE TYPE provisr_state.run_state_v2 AS ENUM (
    'RECEIVED',
    'POLICY_LOADED',
    'CLOUD_CONTEXT_LOADED',
    'CLARIFYING',
    'MANIFEST_CREATING',
    'MANIFEST_VALIDATING',
    'IAC_GENERATING',
    'PLAN_CREATING',
    'POLICY_CHECKING',
    'CONFIRMING',
    'APPROVING',
    'EXECUTING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);

ALTER TABLE provisr_state.provisioning_runs
    ALTER COLUMN state DROP DEFAULT,
    ALTER COLUMN state TYPE provisr_state.run_state_v2
    USING (
        CASE state::text
            WHEN 'received' THEN 'RECEIVED'
            WHEN 'pending_policy' THEN 'POLICY_LOADED'
            WHEN 'pending_cloud_context' THEN 'CLOUD_CONTEXT_LOADED'
            WHEN 'pending_agent' THEN 'MANIFEST_CREATING'
            WHEN 'manifest_ready' THEN 'MANIFEST_VALIDATING'
            WHEN 'pending_iac' THEN 'IAC_GENERATING'
            WHEN 'plan_ready' THEN 'PLAN_CREATING'
            WHEN 'pending_policy_check' THEN 'POLICY_CHECKING'
            WHEN 'pending_confirmation' THEN 'CONFIRMING'
            WHEN 'pending_approval' THEN 'APPROVING'
            WHEN 'pending_execution' THEN 'EXECUTING'
            WHEN 'executing' THEN 'EXECUTING'
            WHEN 'completed' THEN 'COMPLETED'
            WHEN 'failed' THEN 'FAILED'
            WHEN 'cancelled' THEN 'CANCELLED'
        END
    )::provisr_state.run_state_v2,
    ALTER COLUMN state SET DEFAULT 'RECEIVED';

DROP TYPE provisr_state.run_state;
ALTER TYPE provisr_state.run_state_v2 RENAME TO run_state;

-- The state-transition repository must use this compare-and-set predicate in
-- the same transaction as its audit and sse_events inserts:
-- UPDATE ... WHERE id = $id AND state = $expected_state AND state_version = $expected_version.
