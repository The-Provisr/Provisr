ALTER TABLE provisr_identity.workspaces
ADD COLUMN idempotency_key VARCHAR(128);

CREATE UNIQUE INDEX idx_workspaces_idempotency_key ON provisr_identity.workspaces(idempotency_key) WHERE idempotency_key IS NOT NULL;
