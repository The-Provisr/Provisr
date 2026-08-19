import type { PolicyPack } from "@/lib/policy/types";

/**
 * Mock policy packs for the FE-A09 policy settings screen.
 *
 * @migration Replace with data fetched from the policy service (BE-C01)
 * endpoints once they land in the orchestrator.
 */

const s3PublicAccessRego = `# Base policy definition for aws_s3_bucket_public_access
package provisr.aws.s3

import data.provisr.utils.helpers

# Exemption list mapped from UI parameters
exempt_buckets := {
    "web-assets-prod",
    "public-docs-repo"
}

deny[msg] {
    resource := input.resource.aws_s3_bucket[name]

    # Check if bucket is in exempt list
    not exempt_buckets[name]

    # Evaluate public access block configuration
    public_access_block := input.resource.aws_s3_bucket_public_access_block[name]

    has_violation(public_access_block)

    msg := sprintf("S3 bucket '%v' allows public access. All block_public_acls flags must be true.", [name])
}

has_violation(block) {
    block.block_public_acls == false
} else {
    block.block_public_policy == false
}`;

export const policyPacks: PolicyPack[] = [
  {
    id: "secure-baseline",
    name: "Secure Baseline",
    version: "v2.4.1",
    description: "Core security posture requirements based on CIS benchmarks for AWS, Azure, and GCP.",
    enabled: true,
    ruleCount: 42,
    rules: [
      {
        key: "aws_s3_bucket_public_access",
        severity: "deny",
        description: "Ensure all S3 buckets block public ACLs and bucket policies.",
        enabled: true,
        definition:
          "Denies provisioning when an S3 bucket has block_public_acls or block_public_policy set to false.",
        parameters: [
          {
            key: "exempt_buckets",
            label: "Exempted Buckets (comma separated)",
            type: "text",
            value: "web-assets-prod, public-docs-repo",
          },
          {
            key: "action_on_violation",
            label: "Action on Violation",
            type: "multi_select",
            value: ["deny"],
            options: ["deny", "warn", "remediate"],
          },
        ],
        remediationHint:
          "Update your Terraform or CloudFormation to include block_public_acls = true in the S3 bucket configuration block.",
        docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html",
        regoSource: s3PublicAccessRego,
      },
      {
        key: "k8s_container_resources_limits",
        severity: "warn",
        description: "Containers must have CPU and Memory limits defined.",
        enabled: true,
        definition: "Warns when a container resource declares limits for neither cpu nor memory.",
        parameters: [
          {
            key: "min_cpu_millicores",
            label: "Minimum CPU limit (millicores)",
            type: "number",
            value: 100,
            min: 10,
            max: 8000,
            step: 10,
          },
          {
            key: "min_memory_mib",
            label: "Minimum memory limit (MiB)",
            type: "number",
            value: 128,
            min: 32,
            max: 16384,
            step: 32,
          },
        ],
        remediationHint:
          "Add resources.limits.cpu and resources.limits.memory to the container spec in your deployment manifest.",
        docsUrl: "https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/",
        regoSource: `package provisr.k8s.containers

warn[msg] {
    container := input.resource.kubernetes_deployment[name].spec.template.spec.containers[_]
    limits := container.resources.limits
    not limits.cpu
    not limits.memory
    msg := sprintf("Container '%v' has no cpu/memory limits.", [container.name])
}`,
      },
      {
        key: "azure_iam_custom_role_creation",
        severity: "approval",
        description: "Creation of custom IAM roles requires SecOps sign-off.",
        enabled: true,
        definition: "Requires an approval gate before any azurerm_role_definition resource is created.",
        parameters: [
          {
            key: "require_approval",
            label: "Approval workflow required",
            type: "boolean",
            value: true,
          },
        ],
        remediationHint:
          "Route custom role definitions through the approval queue; use built-in roles where possible.",
        docsUrl: "https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles",
        regoSource: `package provisr.azure.iam

approval_required[resource] {
    resource := input.resource.azurerm_role_definition[name]
}`,
      },
    ],
  },
  {
    id: "startup-velocity",
    name: "Startup Velocity",
    version: "v1.1.0",
    description: "Relaxed compliance set optimizing for rapid deployment in non-production sandbox environments.",
    enabled: false,
    ruleCount: 18,
    rules: [
      {
        key: "sandbox_resource_expiry",
        severity: "warn",
        description: "Resources in sandbox environments should carry an expiry tag.",
        enabled: true,
        definition: "Warns when a sandbox resource has no scheduled-expiry tag.",
        parameters: [
          {
            key: "expiry_tag_key",
            label: "Expiry tag key",
            type: "text",
            value: "scheduled-expiry",
          },
        ],
        remediationHint: "Add a scheduled-expiry tag to the resource so it can be reclaimed automatically.",
        regoSource: `package provisr.sandbox.expiry

warn[msg] {
    resource := input.resource[_][name]
    resource.tags.env == "sandbox"
    not resource.tags["scheduled-expiry"]
    msg := sprintf("Resource '%v' has no scheduled-expiry tag.", [name])
}`,
      },
    ],
  },
  {
    id: "regulated",
    name: "Regulated Prod",
    version: "v4.0.2",
    description: "Strict enforcement of HIPAA and SOC2 compliance constraints with automated approvals required.",
    enabled: false,
    ruleCount: 156,
    rules: [
      {
        key: "hipaa_encryption_at_rest",
        severity: "deny",
        description: "All databases must use encryption at rest with customer-managed keys.",
        enabled: true,
        definition: "Denies database provisioning without encryption at rest and a KMS key reference.",
        parameters: [
          {
            key: "allowed_key_types",
            label: "Allowed KMS key types",
            type: "multi_select",
            value: ["customer-managed"],
            options: ["customer-managed", "aws-managed"],
          },
          {
            key: "enforce_backup_retention",
            label: "Enforce backup retention",
            type: "boolean",
            value: true,
          },
        ],
        remediationHint:
          "Set encryption = true and kms_key_id on the database resource, and rotate keys on a schedule.",
        regoSource: `package provisr.hipaa.encryption

deny[msg] {
    db := input.resource.aws_rds_cluster[name]
    not db.storage_encrypted
    msg := sprintf("Database '%v' must be encrypted at rest.", [name])
}`,
      },
    ],
  },
];