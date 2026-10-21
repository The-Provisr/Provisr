-- BE-D08: provisioner-managed remote Terraform state backend per connected
-- cloud account. Settings hold non-secret resource names only (bucket, lock
-- table, storage account); credentials and state contents are never stored.
-- Names are derived deterministically, so a cascaded row is re-referenced,
-- not re-created, when the same workspace reconnects the same account.
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'state_backend_provisioned';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'state_backend_verified';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'state_backend_failed';

CREATE TYPE provisr_iac.state_backend_status AS ENUM ('ready', 'failed');

CREATE TABLE provisr_iac.state_backends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    cloud_account_id UUID NOT NULL UNIQUE REFERENCES provisr_cloud.cloud_accounts(id) ON DELETE CASCADE,
    provider provisr_cloud.provider NOT NULL,
    status provisr_iac.state_backend_status NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    last_error_code VARCHAR(64),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT state_backend_ready_verified CHECK (status <> 'ready' OR verified_at IS NOT NULL)
);

CREATE INDEX idx_state_backends_workspace_id ON provisr_iac.state_backends(workspace_id);

-- Successful ensure requests only; failed attempts stay retryable with the same key.
CREATE TABLE provisr_iac.state_backend_requests (
    state_backend_id UUID NOT NULL REFERENCES provisr_iac.state_backends(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255) NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (state_backend_id, idempotency_key)
);

GRANT USAGE ON SCHEMA provisr_cloud, provisr_iac TO provisr_app;
GRANT USAGE ON TYPE provisr_cloud.provider, provisr_iac.state_backend_status TO provisr_app;
GRANT SELECT ON provisr_cloud.cloud_accounts TO provisr_app;
-- PostgreSQL requires UPDATE privilege on at least one column for row locking.
-- Ensure only share-locks the account against concurrent disconnects; it never writes it.
GRANT UPDATE (updated_at) ON provisr_cloud.cloud_accounts TO provisr_app;
GRANT SELECT, INSERT, UPDATE ON provisr_iac.state_backends TO provisr_app;
GRANT SELECT, INSERT ON provisr_iac.state_backend_requests TO provisr_app;
