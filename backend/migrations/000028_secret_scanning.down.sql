-- Enum values added by the up migration cannot be removed by ALTER TYPE in
-- PostgreSQL; leaving secret_detected in place is safe after this rollback.
SELECT 1;
