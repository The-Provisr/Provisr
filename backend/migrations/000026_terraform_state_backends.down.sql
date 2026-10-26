-- Dropping these rows never deletes the cloud state buckets/tables themselves;
-- deterministic naming re-references them if this migration is reapplied.
-- Enum values added by the up migration cannot be removed by ALTER TYPE in
-- PostgreSQL; leaving them in place is safe even after this rollback.
REVOKE UPDATE (updated_at) ON provisr_cloud.cloud_accounts FROM provisr_app;
REVOKE SELECT ON provisr_cloud.cloud_accounts FROM provisr_app;
DROP TABLE IF EXISTS provisr_iac.state_backend_requests;
DROP TABLE IF EXISTS provisr_iac.state_backends;
DROP TYPE IF EXISTS provisr_iac.state_backend_status;
