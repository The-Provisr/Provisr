CREATE SCHEMA IF NOT EXISTS provisr_events;

CREATE TYPE provisr_events.event_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE provisr_events.sse_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    event_id VARCHAR(128) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    correlation_id UUID NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status provisr_events.event_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sse_events_workspace_id ON provisr_events.sse_events(workspace_id);
CREATE INDEX idx_sse_events_status ON provisr_events.sse_events(status) WHERE status = 'pending';
CREATE INDEX idx_sse_events_created_at ON provisr_events.sse_events(created_at);
