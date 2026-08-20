CREATE SCHEMA IF NOT EXISTS provisr_policy;

CREATE TYPE provisr_policy.pack_category AS ENUM ('security', 'cost', 'compliance', 'environment');
CREATE TYPE provisr_policy.rule_severity AS ENUM ('deny', 'warn', 'approval_required');
CREATE TYPE provisr_policy.policy_mode AS ENUM ('enforced', 'audit_only');

CREATE TABLE provisr_policy.policy_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category provisr_policy.pack_category NOT NULL,
    is_system_pack BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_policy_packs_workspace ON provisr_policy.policy_packs(workspace_id);
CREATE INDEX idx_policy_packs_category ON provisr_policy.policy_packs(category);

CREATE TABLE provisr_policy.policy_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES provisr_policy.policy_packs(id) ON DELETE CASCADE,
    rule_key VARCHAR(128) NOT NULL UNIQUE,
    rego_rule TEXT NOT NULL,
    severity provisr_policy.rule_severity NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    remediation_hint TEXT NOT NULL DEFAULT '',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    parameters_schema JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_policy_rules_pack ON provisr_policy.policy_rules(pack_id);
CREATE INDEX idx_policy_rules_severity ON provisr_policy.policy_rules(severity);

CREATE TABLE provisr_policy.workspace_policy_settings (
    workspace_id UUID PRIMARY KEY REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE,
    enabled_pack_ids UUID[] NOT NULL DEFAULT '{}',
    mode provisr_policy.policy_mode NOT NULL DEFAULT 'enforced',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
