-- Provision the cluster-scoped application role. Runs once when the postgres
-- container initializes its data directory (docker-entrypoint-initdb.d).
-- Roles are cluster-wide, so this lives in infrastructure, not in the
-- database migrations; migrations only apply database-local grants.
CREATE ROLE provisr_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'provisr-app-dev';