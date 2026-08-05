-- BE-B03: per-connection external ID for AWS AssumeRole.
-- Stores SHA-256 hash only; plaintext is shown once at creation.
ALTER TABLE provisr_cloud.cloud_accounts
    ADD COLUMN IF NOT EXISTS external_id_hash CHAR(64);
