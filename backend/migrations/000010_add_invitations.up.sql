CREATE TABLE provisr_identity.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role provisr_identity.member_role NOT NULL,
    code VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_invitations_code ON provisr_identity.invitations(code);
CREATE INDEX idx_invitations_workspace ON provisr_identity.invitations(workspace_id);
