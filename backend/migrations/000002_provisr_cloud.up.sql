CREATE SCHEMA IF NOT EXISTS provisr_cloud;

CREATE TYPE provisr_cloud.provider AS ENUM ('aws', 'azure', 'gcp');

CREATE TYPE provisr_cloud.account_status AS ENUM ('pending', 'active', 'failed', 'disconnected');

CREATE TABLE provisr_cloud.cloud_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    provider provisr_cloud.provider NOT NULL,
    label VARCHAR(255) NOT NULL,
    external_account_id VARCHAR(128),
    metadata JSONB NOT NULL DEFAULT '{}',
    status provisr_cloud.account_status NOT NULL DEFAULT 'pending',
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- PRD §7: one account per provider per workspace in MVP. Separate envs → separate workspaces.
    UNIQUE (workspace_id, provider)
);

CREATE INDEX idx_cloud_accounts_status ON provisr_cloud.cloud_accounts(status);
