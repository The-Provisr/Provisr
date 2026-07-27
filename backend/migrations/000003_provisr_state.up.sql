CREATE SCHEMA IF NOT EXISTS provisr_state;

CREATE TYPE provisr_state.session_status AS ENUM ('active', 'archived', 'deleted');

CREATE TYPE provisr_state.run_state AS ENUM (
    'received',
    'pending_policy',
    'pending_cloud_context',
    'pending_agent',
    'manifest_ready',
    'pending_iac',
    'plan_ready',
    'pending_policy_check',
    'pending_confirmation',
    'pending_approval',
    'pending_execution',
    'executing',
    'completed',
    'failed',
    'cancelled'
);

CREATE TYPE provisr_state.policy_decision AS ENUM ('allow', 'warn', 'deny', 'requires_approval');

CREATE TYPE provisr_state.approval_status AS ENUM ('not_required', 'pending', 'approved', 'rejected');

CREATE TYPE provisr_state.execution_status AS ENUM ('pending', 'running', 'succeeded', 'failed');

CREATE TABLE provisr_state.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES provisr_identity.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status provisr_state.session_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provisr_state.provisioning_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES provisr_state.chat_sessions(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES provisr_identity.users(id),
    state provisr_state.run_state NOT NULL DEFAULT 'received',
    state_version INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL,
    manifest_version INTEGER,
    policy_decision provisr_state.policy_decision,
    approval_status provisr_state.approval_status NOT NULL DEFAULT 'not_required',
    execution_status provisr_state.execution_status NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    correlation_id UUID NOT NULL,
    error_code VARCHAR(64),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_chat_sessions_workspace_id ON provisr_state.chat_sessions(workspace_id);
CREATE INDEX idx_chat_sessions_user_id ON provisr_state.chat_sessions(user_id);
CREATE INDEX idx_provisioning_runs_session_id ON provisr_state.provisioning_runs(session_id);
CREATE INDEX idx_provisioning_runs_workspace_id ON provisr_state.provisioning_runs(workspace_id);
CREATE INDEX idx_provisioning_runs_state ON provisr_state.provisioning_runs(state);
CREATE INDEX idx_provisioning_runs_correlation_id ON provisr_state.provisioning_runs(correlation_id);

