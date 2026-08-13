-- Audit event types for workspace, member, and invitation operations
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'workspace_created';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'workspace_updated';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'workspace_deleted';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'member_added';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'member_role_updated';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'member_removed';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'invitation_created';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'invitation_revoked';
ALTER TYPE provisr_audit.event_type ADD VALUE IF NOT EXISTS 'invitation_accepted';
