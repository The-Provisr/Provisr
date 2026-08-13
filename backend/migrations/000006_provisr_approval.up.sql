CREATE SCHEMA IF NOT EXISTS provisr_approval;

CREATE TYPE provisr_approval.ticket_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE provisr_approval.approval_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL UNIQUE REFERENCES provisr_state.provisioning_runs(id) ON DELETE CASCADE,
    status provisr_approval.ticket_status NOT NULL DEFAULT 'pending',
    token_approve_hash CHAR(64),
    token_reject_hash CHAR(64),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_tickets_status ON provisr_approval.approval_tickets(status);
