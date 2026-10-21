-- Generated artifacts must be archived before rolling back this migration.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM provisr_iac.artifacts WHERE generation IS NOT NULL) THEN
        RAISE EXCEPTION 'Archive generated Terraform artifacts before rollback';
    END IF;
END $$;
DROP TRIGGER terraform_artifacts_immutable ON provisr_iac.artifacts;
DROP INDEX provisr_iac.idx_iac_generation_key;
DROP INDEX provisr_iac.idx_iac_manifest_generation;
ALTER TABLE provisr_iac.artifacts DROP CONSTRAINT terraform_generation_complete,
    DROP COLUMN generation, DROP COLUMN idempotency_key, DROP COLUMN manifest_id;
REVOKE UPDATE (state_version) ON provisr_state.provisioning_runs FROM provisr_app;
