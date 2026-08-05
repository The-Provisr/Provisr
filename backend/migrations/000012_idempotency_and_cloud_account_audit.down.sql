-- Enum values added by the up migration cannot be removed by ALTER TYPE in
-- PostgreSQL; leaving them in place is safe even after this rollback.
DROP TABLE IF EXISTS provisr_idempotency.keys;
DROP SCHEMA IF EXISTS provisr_idempotency;
