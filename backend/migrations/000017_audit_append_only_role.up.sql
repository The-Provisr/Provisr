-- BE-A03 review: least-privilege database role for the workspace service.
-- The audit table is append-only at the engine level via the tamper trigger
-- (000015); this migration adds the same guarantee at the privilege level
-- (defense in depth). The application connects as provisr_app, which can read
-- the chain tail and append events but can never UPDATE or DELETE rows.
CREATE ROLE provisr_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'provisr-app-dev';

GRANT USAGE ON SCHEMA provisr_identity TO provisr_app;
GRANT USAGE ON SCHEMA provisr_state TO provisr_app;
GRANT USAGE ON SCHEMA provisr_audit TO provisr_app;
GRANT USAGE ON SCHEMA provisr_idempotency TO provisr_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    provisr_identity.users,
    provisr_identity.workspaces,
    provisr_identity.memberships,
    provisr_identity.invitations
    TO provisr_app;

GRANT SELECT ON
    provisr_state.chat_sessions,
    provisr_state.provisioning_runs
    TO provisr_app;

GRANT SELECT, INSERT ON provisr_idempotency.keys TO provisr_app;

-- Append-only: read the chain tail and append; never mutate, delete, or
-- truncate rows. The table stays owned by the migration role, never by the
-- application role, so provisr_app cannot drop privileges or the trigger.
GRANT SELECT, INSERT ON provisr_audit.audit_events TO provisr_app;
REVOKE UPDATE, DELETE, TRUNCATE ON provisr_audit.audit_events FROM provisr_app;

GRANT USAGE ON TYPE
    provisr_identity.environment,
    provisr_identity.member_role,
    provisr_audit.event_type,
    provisr_audit.actor_type
    TO provisr_app;