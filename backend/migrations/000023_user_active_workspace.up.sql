-- Persist membership-checked workspace selection across sign-ins and restarts.
ALTER TABLE provisr_identity.users ADD COLUMN active_workspace_id UUID
    REFERENCES provisr_identity.workspaces(id) ON DELETE SET NULL;
