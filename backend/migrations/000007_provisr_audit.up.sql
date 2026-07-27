CREATE SCHEMA IF NOT EXISTS provisr_audit;

CREATE TYPE provisr_audit.event_type AS ENUM (
    'prompt_received',
    'run_created',
    'state_transition',
    'tool_call',
    'manifest_created',
    'artifact_generated',
    'policy_check',
    'confirmation',
    'approval_decision',
    'execution_started',
    'execution_completed',
    'execution_failed',
    'cloud_state_synced',
    'drift_detected',
    'error'
);

CREATE TYPE provisr_audit.actor_type AS ENUM ('user', 'agent', 'system');

CREATE TABLE provisr_audit.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    event_type provisr_audit.event_type NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_type provisr_audit.actor_type NOT NULL,
    resource_type VARCHAR(64),
    resource_id VARCHAR(128),
    payload JSONB NOT NULL DEFAULT '{}',
    hash CHAR(64) NOT NULL UNIQUE,
    previous_hash CHAR(64) REFERENCES provisr_audit.audit_events(hash),
    correlation_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_workspace_id ON provisr_audit.audit_events(workspace_id);
CREATE INDEX idx_audit_events_event_type ON provisr_audit.audit_events(event_type);
CREATE INDEX idx_audit_events_correlation_id ON provisr_audit.audit_events(correlation_id);
CREATE INDEX idx_audit_events_created_at ON provisr_audit.audit_events(created_at);
