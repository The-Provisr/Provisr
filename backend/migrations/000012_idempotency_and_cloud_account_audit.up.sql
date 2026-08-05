-- BE-B01 review: idempotency keys for cloud account mutations and audit
-- event types covering the cloud account lifecycle.

CREATE SCHEMA IF NOT EXISTS provisr_idempotency;

-- The key is scoped to its workspace: a key used by one workspace must not
-- block another workspace's mutation (a global primary key would allow a
-- cross-workspace mutation denial).
CREATE TABLE provisr_idempotency.keys (
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    key          VARCHAR(128) NOT NULL,
    mutation     VARCHAR(64) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, key)
);

ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'cloud_account_created';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'cloud_account_status_changed';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'cloud_account_deleted';
