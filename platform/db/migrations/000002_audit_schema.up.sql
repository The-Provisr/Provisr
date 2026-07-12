-- ============================================================
-- SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS provisr_audit;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE audit_event_type AS ENUM (
    'STATE_TRANSITION',
    'AGENT_TOOL_CALL',
    'LLM_INVOCATION',
    'POLICY_RESULT',
    'POLICY_WAIVER',
    'APPROVAL_DECISION',
    'APPROVAL_DELEGATED',
    'PROVISIONING_RESULT',
    'RESOURCE_MUTATION',
    'DRIFT_DETECTED',
    'DRIFT_RESOLVED',
    'AUTH',
    'ROLE_GRANT',
    'ROLE_REVOKE',
    'SECRET_ACCESS',
    'DATA_EXPORT',
    'PII_REDACTION'
);

CREATE TYPE severity AS ENUM (
    'INFO',
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

CREATE TYPE principal_type AS ENUM (
    'user',
    'system'
);

-- ============================================================
-- TABLE: audit_events
-- ============================================================

CREATE TABLE provisr_audit.audit_events (
    event_id            UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID                NOT NULL,
    event_type          audit_event_type    NOT NULL,
    event_severity      severity            NOT NULL DEFAULT 'INFO',
    actor_type          principal_type      NOT NULL,
    actor_id            UUID,
    actor_role_snapshot VARCHAR(64),
    actor_ip            INET,
    actor_user_agent    VARCHAR(512),
    request_id          UUID,
    resource_id         UUID,
    subject_type        VARCHAR(64),
    subject_id          UUID,
    action              VARCHAR(64)         NOT NULL,
    outcome             VARCHAR(16)         NOT NULL,
    reason              TEXT,
    from_state          VARCHAR(64),
    to_state            VARCHAR(64),
    tool_name           VARCHAR(64),
    policy_violations   JSONB,
    manifest_hash       CHAR(64),
    trace_id            VARCHAR(64),
    span_id             VARCHAR(32),
    correlation_id      VARCHAR(64),
    source_service      VARCHAR(64)         NOT NULL,
    source_version      VARCHAR(32),
    metadata            JSONB,
    prev_event_hash     CHAR(64),
    event_hash          CHAR(64)            NOT NULL,
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT now(),

    -- outcome must be 'success', 'failure', or 'denied'
    CONSTRAINT chk_audit_outcome CHECK (outcome IN ('success', 'failure', 'denied')),

    -- reason required when outcome is not 'success'
    CONSTRAINT chk_audit_reason_required CHECK (
        (outcome = 'success') OR (reason IS NOT NULL)
    )
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Most queries filter by org + time range
CREATE INDEX idx_audit_org_created
    ON provisr_audit.audit_events (org_id, created_at DESC);

-- Look up all events for a given provisioning request
CREATE INDEX idx_audit_request
    ON provisr_audit.audit_events (request_id, created_at DESC);

-- Look up events for a specific resource
CREATE INDEX idx_audit_resource
    ON provisr_audit.audit_events (resource_id, created_at DESC);

-- Look up events by actor (who did what)
CREATE INDEX idx_audit_actor
    ON provisr_audit.audit_events (actor_id, created_at DESC);

-- Filter by event type (e.g. all DRIFT_DETECTED events)
CREATE INDEX idx_audit_event_type
    ON provisr_audit.audit_events (event_type, created_at DESC);

-- Trace ID lookup for distributed debugging
CREATE INDEX idx_audit_trace
    ON provisr_audit.audit_events (trace_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE provisr_audit.audit_events ENABLE ROW LEVEL SECURITY;

-- audit_writer role can access all rows (INSERT from audit service, SELECT for hash chain)
CREATE POLICY audit_writer_all_access ON provisr_audit.audit_events
    FOR ALL
    TO audit_writer
    USING (true)
    WITH CHECK (true);

-- Restrictive policy for all other roles (e.g. future auditor role)
-- Filters rows by the session-level org_id setting
CREATE POLICY tenant_isolation_audit ON provisr_audit.audit_events
    FOR ALL
    USING (org_id = current_setting('provisr.current_org', true)::uuid);

-- ============================================================
-- AUDIT_WRITER ROLE (append-only enforcement)
-- ============================================================

-- Create a restricted role with INSERT-only access
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
        CREATE ROLE audit_writer WITH LOGIN PASSWORD 'audit_writer_secret' NOBYPASSRLS;
    END IF;
END
$$;

-- Grant schema usage
GRANT USAGE ON SCHEMA provisr_audit TO audit_writer;

-- Grant INSERT only — explicitly NOT UPDATE or DELETE
GRANT INSERT ON provisr_audit.audit_events TO audit_writer;

GRANT SELECT ON provisr_audit.audit_events TO audit_writer;
-- Restrict access to other tables in public schema if any
-- (audit_writer should not touch anything else)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM audit_writer;