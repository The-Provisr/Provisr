ALTER TABLE provisr_cloud.cloud_accounts
    DROP COLUMN metadata_encrypted,
    DROP COLUMN external_account_id_hash,
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN external_account_id VARCHAR(128);

DROP INDEX IF EXISTS provisr_cloud.idx_cloud_accounts_external_id_hash;
