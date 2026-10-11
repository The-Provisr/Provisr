-- Security Baseline pack
INSERT INTO provisr_policy.policy_packs (id, workspace_id, name, description, category, is_system_pack)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    NULL,
    'Security Baseline',
    'Core security rules: no public S3, encryption required, IAM least privilege',
    'security',
    true
);

INSERT INTO provisr_policy.policy_rules (pack_id, rule_key, rego_rule, severity, description, remediation_hint, parameters_schema) VALUES
('a0000000-0000-0000-0000-000000000001', 'no_public_s3',
 'package provisr.security\n\ndefault allow = true\n\ndeny[msg] {\n  input.resource_type == "aws_s3_bucket"\n  public_acls := {"public-read", "public-read-write"}\n  public_acls[input.planned_values.acl]\n  msg := "S3 bucket must not have public-read or public-read-write ACL"\n}',
 'deny', 'Deny S3 buckets with public ACLs', 'Set the S3 bucket ACL to private or use bucket policies for controlled access.', '{}'),
('a0000000-0000-0000-0000-000000000001', 'require_encryption',
 'package provisr.security\n\ndefault allow = true\n\ndeny[msg] {\n  input.resource_type == "aws_ebs_volume"\n  not input.planned_values.encrypted\n  msg := "EBS volumes must be encrypted"\n}',
 'deny', 'Require encryption on storage resources', 'Enable encryption at rest for all storage resources (EBS, S3, RDS).', '{}'),
('a0000000-0000-0000-0000-000000000001', 'iam_no_wildcard',
 'package provisr.security\n\ndefault allow = true\n\ndeny[msg] {\n  input.resource_type == "aws_iam_policy"\n  input.planned_values.statement[_].actions[_] == "*"\n  msg := "IAM policies must not use wildcard actions"\n}',
 'deny', 'Deny IAM policies with wildcard actions', 'Replace wildcard (*) actions with specific, least-privilege permissions.', '{}');

-- Cost Controls pack
INSERT INTO provisr_policy.policy_packs (id, workspace_id, name, description, category, is_system_pack)
VALUES (
    'a0000000-0000-0000-0000-000000000002',
    NULL,
    'Cost Controls',
    'Budget enforcement and cost optimization rules',
    'cost',
    true
);

INSERT INTO provisr_policy.policy_rules (pack_id, rule_key, rego_rule, severity, description, remediation_hint, parameters_schema) VALUES
('a0000000-0000-0000-0000-000000000002', 'budget_max',
 'package provisr.cost\n\ndefault allow = true\n\nwarn[msg] {\n  input.estimated_monthly_cost_usd > input.parameters.max_usd\n  msg := sprintf("Estimated monthly cost $%.2f exceeds budget $%.2f", [input.estimated_monthly_cost_usd, input.parameters.max_usd])\n}',
 'warn', 'Warn when estimated monthly cost exceeds budget', 'Review resource sizing or request a budget increase.', '{"max_usd": 1000}');

-- Compliance Standard pack
INSERT INTO provisr_policy.policy_packs (id, workspace_id, name, description, category, is_system_pack)
VALUES (
    'a0000000-0000-0000-0000-000000000003',
    NULL,
    'Compliance Standard',
    'Required tags, allowed regions, and compliance standards',
    'compliance',
    true
);

INSERT INTO provisr_policy.policy_rules (pack_id, rule_key, rego_rule, severity, description, remediation_hint, parameters_schema) VALUES
('a0000000-0000-0000-0000-000000000003', 'required_tags',
 'package provisr.compliance\n\ndefault allow = true\n\ndeny[msg] {\n  required := input.parameters.tags\n  tag := required[_]\n  not input.planned_values.tags[tag]\n  msg := sprintf("Required tag ''%s'' is missing", [tag])\n}',
 'deny', 'Require specific tags on all resources', 'Add the required tags to the resource configuration.', '{"tags": ["Environment", "Team", "CostCenter"]}'),
('a0000000-0000-0000-0000-000000000003', 'allowed_regions',
 'package provisr.compliance\n\ndefault allow = true\n\ndeny[msg] {\n  allowed := input.parameters.regions\n  not region_allowed(allowed, input.region)\n  msg := sprintf("Region ''%s'' is not in the allowed list", [input.region])\n}\n\nregion_allowed(allowed, region) {\n  allowed[_] == region\n}',
 'deny', 'Restrict resources to allowed regions', 'Deploy resources only in approved regions.', '{"regions": ["us-east-1", "us-west-2", "eu-west-1"]}');
