-- BE-B01 review: idempotency keys for cloud account mutations and audit
-- event types covering the cloud account lifecycle.

CREATE SCHEMA IF NOT EXISTS provisr_idempotency;

CREATE TABLE provisr_idempotency.keys (
    key          VARCHAR(128) PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    mutation     VARCHAR(64) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_idempotency_keys_workspace_id
    ON provisr_idempotency.keys(workspace_id);

ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'cloud_account_created';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'cloud_account_status_changed';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'cloud_account_deleted';
