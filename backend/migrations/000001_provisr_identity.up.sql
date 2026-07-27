CREATE SCHEMA IF NOT EXISTS provisr_identity;

CREATE TYPE provisr_identity.environment AS ENUM ('dev', 'staging', 'prod');

CREATE TYPE provisr_identity.member_role AS ENUM ('admin', 'engineer', 'approver', 'auditor', 'viewer');

CREATE TABLE provisr_identity.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provisr_identity.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    environment provisr_identity.environment NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE provisr_identity.memberships (
    user_id UUID NOT NULL REFERENCES provisr_identity.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    role provisr_identity.member_role NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    invited_by UUID REFERENCES provisr_identity.users(id),
    PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX idx_memberships_workspace_id ON provisr_identity.memberships(workspace_id);
CREATE INDEX idx_memberships_user_id ON provisr_identity.memberships(user_id);
CREATE INDEX idx_workspaces_deleted_at ON provisr_identity.workspaces(deleted_at) WHERE deleted_at IS NOT NULL;
