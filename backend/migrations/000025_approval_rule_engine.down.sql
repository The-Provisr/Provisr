-- PostgreSQL cannot drop enum values; 'approval_requirements_evaluated' is left in place
-- because append-only audit rows may reference it.
SELECT 1;
