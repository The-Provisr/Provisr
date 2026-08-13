-- Down migration revokes the database-local grants from 000017. The
-- cluster-scoped role provisr_app itself is provisioned by infrastructure
-- (infra/docker/postgres-init/01_provisr_app_role.sql) and is NOT dropped
-- here: roles are cluster-wide, so a database migration must not own it.

REVOKE USAGE ON SCHEMA provisr_identity FROM provisr_app;
REVOKE USAGE ON SCHEMA provisr_state FROM provisr_app;
REVOKE USAGE ON SCHEMA provisr_audit FROM provisr_app;
REVOKE USAGE ON SCHEMA provisr_idempotency FROM provisr_app;

REVOKE ALL ON
    provisr_identity.users,
    provisr_identity.workspaces,
    provisr_identity.memberships,
    provisr_identity.invitations
    FROM provisr_app;

REVOKE ALL ON
    provisr_state.chat_sessions,
    provisr_state.provisioning_runs
    FROM provisr_app;

REVOKE ALL ON provisr_idempotency.keys FROM provisr_app;

REVOKE ALL ON provisr_audit.audit_events FROM provisr_app;

REVOKE USAGE ON TYPE
    provisr_identity.environment,
    provisr_identity.member_role,
    provisr_audit.event_type,
    provisr_audit.actor_type
    FROM provisr_app;