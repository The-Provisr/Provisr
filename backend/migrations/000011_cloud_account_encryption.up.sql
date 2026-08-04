-- BE-B01: cloud account metadata is stored encrypted at rest.
-- Surface fields (provider, label, status, verified_at) stay plaintext;
-- the metadata payload moves to a dedicated encrypted TEXT column and the
-- AWS external account id is stored as an HMAC hash (lookup-matchable
-- without decryption, never plaintext).

ALTER TABLE provisr_cloud.cloud_accounts
    DROP COLUMN metadata,
    DROP COLUMN external_account_id,
    ADD COLUMN metadata_encrypted TEXT NOT NULL,
    ADD COLUMN external_account_id_hash VARCHAR(64);

CREATE INDEX idx_cloud_accounts_external_id_hash
    ON provisr_cloud.cloud_accounts(external_account_id_hash);
