-- ENUMS
CREATE TYPE user_role AS ENUM ('admin', 'engineer', 'viewer', 'auditor');
CREATE TYPE request_intent AS ENUM ('CREATE', 'UPDATE', 'DESTROY', 'IMPORT', 'REPROVISION');
CREATE TYPE request_status AS ENUM ('RECEIVED', 'PENDING_AGENT', 'POLICY_CHECK', 'PENDING_APPROVAL', 'PROVISIONING', 'LIVE', 'FAILED', 'ABANDONED');
CREATE TYPE cloud_provider AS ENUM ('aws', 'gcp', 'azure');
CREATE TYPE resource_status AS ENUM ('PROVISIONING', 'LIVE', 'DRIFTED', 'MISSING', 'DECOMMISSIONED');

-- TABLES
CREATE TABLE organizations (
    org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_slug VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    billing_email VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    monthly_budget_usd NUMERIC(12,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
    cognito_sub VARCHAR(128) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'engineer',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provisioning_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
    submitter_user_id UUID NOT NULL REFERENCES users(user_id),
    intent request_intent NOT NULL,
    status request_status NOT NULL,
    nl_input TEXT NOT NULL,
    estimated_cost_usd NUMERIC(12,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE resources (
    resource_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
    created_by_request_id UUID REFERENCES provisioning_requests(request_id),
    provider cloud_provider NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    provider_resource_id VARCHAR(256),
    region VARCHAR(64),
    display_name VARCHAR(255),
    desired_spec JSONB NOT NULL,
    actual_spec JSONB,
    status resource_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES provisioning_requests(request_id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
    session_status VARCHAR(32) NOT NULL,
    current_iteration SMALLINT NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(10,6) DEFAULT 0,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    tool_call_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ROW LEVEL SECURITY (RLS)
-- This enforces tenant isolation by strictly checking the current_setting variable[cite: 1].
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users FOR ALL USING (org_id = current_setting('provisr.current_org', true)::uuid);
CREATE POLICY tenant_isolation_reqs ON provisioning_requests FOR ALL USING (org_id = current_setting('provisr.current_org', true)::uuid);
CREATE POLICY tenant_isolation_res ON resources FOR ALL USING (org_id = current_setting('provisr.current_org', true)::uuid);
CREATE POLICY tenant_isolation_sessions ON agent_sessions FOR ALL USING (org_id = current_setting('provisr.current_org', true)::uuid);
CREATE POLICY tenant_isolation_messages ON conversation_messages FOR ALL USING (
    session_id IN (SELECT session_id FROM agent_sessions WHERE org_id = current_setting('provisr.current_org', true)::uuid)
);
