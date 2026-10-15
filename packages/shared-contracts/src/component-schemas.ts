import { z } from "zod";

export const approvalRequestSchema = z.object({
  requestId: z.string(),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  reason: z.string(),
  requiredApprovers: z.array(z.string()).optional(),
  autoApprovalEligible: z.boolean().default(false),
  expiresAt: z.string().optional(),
});

export const architectureSummarySchema = z.object({
  title: z.string().optional(),
  provider: z.enum(["aws", "azure", "gcp", "unknown"]).default("unknown"),
  region: z.string(),
  environment: z.string(),
  estimatedCostUsd: z.number().optional(),
  resources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      tier: z.string().optional(),
      properties: z.record(z.string()).optional(),
    }),
  ),
  highlights: z.array(z.string()).optional(),
});

export const artifactViewerSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["manifest", "terraform", "diagram", "cost_report", "policy_report"]),
  url: z.string().optional(),
  content: z.string().optional(),
  sizeBytes: z.number().optional(),
});

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  senderName: z.string().optional(),
  createdAt: z.string().optional(),
  status: z.enum(["sending", "sent", "complete", "failed"]).optional(),
  toolSummary: z
    .object({
      toolName: z.string(),
      durationMs: z.number().optional(),
      result: z.string().optional(),
    })
    .optional(),
});

export const clarificationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  description: z.string().optional(),
  inputType: z.enum(["single_select", "multi_select", "text", "confirmation"]),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  selected: z.union([z.string(), z.array(z.string())]).optional(),
  answered: z.boolean().optional(),
});

export const cloudStateSchema = z.object({
  cloudAccountId: z.string(),
  provider: z.enum(["aws", "azure", "gcp"]),
  syncedAt: z.string(),
  totalResources: z.number(),
  healthyCount: z.number(),
  unhealthyCount: z.number(),
});

export const computePlanSchema = z.object({
  service: z.string(),
  provider: z.enum(["aws", "azure", "gcp"]).optional(),
  instanceType: z.string().optional(),
  replicaCount: z.number().default(1),
  autoScaling: z
    .object({
      min: z.coerce.number(),
      max: z.coerce.number(),
      desired: z.coerce.number().optional(),
      targetCpuUtilization: z.coerce.number().optional(),
    })
    .refine((value) => value.min <= value.max, {
      message: "autoScaling.min must be less than or equal to autoScaling.max",
    })
    .optional(),
  os: z.string().optional(),
  architecture: z.enum(["x86_64", "arm64"]).optional(),
  vcpu: z.coerce.number().optional(),
  memoryGb: z.coerce.number().optional(),
  hourlyCostUsd: z.coerce.number().optional(),
  monthlyCostUsd: z.coerce.number().optional(),
  reservation: z.enum(["reserved", "on-demand", "spot"]).optional(),
  policyNotes: z.array(z.string()).optional(),
});

export const containerCardSchema = z.object({
  image: z.string(),
  tag: z.string().optional(),
  port: z.number(),
  environmentVariables: z.record(z.string()).optional(),
  cpu: z.string().optional(),
  memory: z.string().optional(),
  healthCheckPath: z.string().optional(),
});

export const costEstimateSchema = z.object({
  currency: z.string().default("USD"),
  monthlyTotalUsd: z.number(),
  breakdown: z.array(
    z.object({
      category: z.string(),
      serviceName: z.string(),
      costUsd: z.number(),
      unit: z.string().optional(),
    }),
  ),
  previousMonthlyCostUsd: z.number().optional(),
  deltaPercentage: z.number().optional(),
});

// Security fields and backup retention are required with no defaults: a payload
// that omits them must fail validation instead of rendering as if it were safe.
export const databaseConfigSchema = z.object({
  engine: z.string().min(1),
  version: z.string().optional(),
  instanceClass: z.string().optional(),
  allocatedStorageGb: z.number().positive(),
  maxAllocatedStorageGb: z.number().positive().optional(),
  storageType: z.string().optional(),
  multiAz: z.boolean().default(false),
  backupRetentionDays: z.number().int().min(0),
  maintenanceWindow: z.string().optional(),
  storageEncrypted: z.boolean(),
  publiclyAccessible: z.boolean(),
  deletionProtection: z.boolean(),
}).refine(
  (value) =>
    value.maxAllocatedStorageGb === undefined ||
    value.maxAllocatedStorageGb >= value.allocatedStorageGb,
  {
    message: "maxAllocatedStorageGb must be greater than or equal to allocatedStorageGb",
    path: ["maxAllocatedStorageGb"],
  },
);

// Provider support (`supported`, `managedServices`) comes from the payload so
// the agent stays the source of truth; there is no frontend lookup table.
export const databaseEngineSelectorSchema = z.object({
  runId: z.string().min(1),
  provider: z.enum(["aws", "azure", "gcp"]),
  recommendedEngine: z.string().optional(),
  selectedEngine: z.string().optional(),
  reasoning: z.string().optional(),
  availableEngines: z
    .array(
      z.object({
        engine: z.string().min(1),
        displayName: z.string().min(1),
        version: z.string().min(1),
        supported: z.boolean(),
        managedServices: z.array(z.string()).default([]),
        bestFor: z.string().optional(),
      }),
    )
    .min(1),
});

export const driftStatusSchema = z.object({
  hasDrift: z.boolean(),
  lastCheckedAt: z.string(),
  driftedResources: z
    .array(
      z.object({
        resourceId: z.string(),
        resourceName: z.string().optional(),
        resourceType: z.string(),
        property: z.string(),
        expectedValue: z.string(),
        actualValue: z.string(),
      }),
    )
    .optional(),
});

export const executionTimelineSchema = z.object({
  currentStep: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
      durationMs: z.number().optional(),
      startedAt: z.string().optional(),
      completedAt: z.string().optional(),
    }),
  ),
});

export const loadbalancerCardSchema = z.object({
  name: z.string(),
  type: z.enum(["application", "network", "gateway"]).default("application"),
  scheme: z.enum(["internet-facing", "internal"]).default("internet-facing"),
  listeners: z.array(
    z.object({
      port: z.number(),
      protocol: z.string(),
      sslCertificate: z.boolean().optional(),
    }),
  ),
  targetGroups: z
    .array(
      z.object({
        name: z.string(),
        port: z.number(),
        healthCheckStatus: z.string().optional(),
      }),
    )
    .optional(),
});

export const monitoringCardSchema = z.object({
  service: z.string(),
  metrics: z.array(
    z.object({
      name: z.string(),
      unit: z.string(),
      threshold: z.string().optional(),
    }),
  ),
  alertEndpoints: z.array(z.string()).optional(),
  logRetentionDays: z.number().optional(),
  dashboardEnabled: z.boolean().default(true),
});

export const firewallRuleSchema = z.object({
  direction: z.enum(["ingress", "egress"]),
  protocol: z.string(),
  portRange: z.string(),
  source: z.string().optional(),
  destination: z.string().optional(),
});

export const networkingTopologySchema = z.object({
  vpcName: z.string().optional(),
  vpcCidr: z.string(),
  subnets: z.array(
    z.object({
      name: z.string(),
      cidr: z.string(),
      type: z.enum(["public", "private", "isolated"]),
      zone: z.string().optional(),
    }),
  ),
  natGateway: z.boolean().optional(),
  internetGateway: z.boolean().optional(),
  securityGroups: z
    .array(
      z.object({
        name: z.string(),
        rulesCount: z.coerce.number().optional(),
        rules: z.array(firewallRuleSchema).optional(),
      }),
    )
    .optional(),
});

export const policyResultSchema = z.object({
  status: z.enum(["passed", "failed", "warning", "pending"]),
  packName: z.string().optional(),
  evaluatedCount: z.number(),
  passedCount: z.number(),
  violations: z
    .array(
      z.object({
        ruleId: z.string(),
        severity: z.enum(["critical", "high", "medium", "low"]),
        message: z.string(),
        remediation: z.string().optional(),
      }),
    )
    .optional(),
});

export const regionSelectorSchema = z.object({
  provider: z.enum(["aws", "azure", "gcp"]),
  selectedRegion: z.string(),
  availableRegions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      latencyMs: z.number().optional(),
      complianceCompliant: z.boolean().optional(),
    }),
  ),
  reasoning: z.string().optional(),
});

export const resourceTableSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      provider: z.string(),
      status: z.string(),
      monthlyCostUsd: z.number().optional(),
    }),
  ),
});

export const securityWarningSchema = z.object({
  title: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  description: z.string(),
  affectedResource: z.string().optional(),
  mitigationSteps: z.array(z.string()).optional(),
});

export const storageCardSchema = z.object({
  bucketName: z.string(),
  storageClass: z.string().optional(),
  versioning: z.boolean().default(false),
  encryption: z.string().optional(),
  publicAccessBlocked: z.boolean().default(true),
  lifecycleRulesCount: z.number().optional(),
});

export const terraformPlanDiffSchema = z.object({
  addCount: z.number(),
  changeCount: z.number(),
  destroyCount: z.number(),
  changes: z.array(
    z.object({
      resourceType: z.string(),
      resourceName: z.string(),
      action: z.enum(["create", "update", "delete", "no-op"]),
      details: z.string().optional(),
    }),
  ),
});

export const terraformReviewSchema = z.object({
  moduleName: z.string(),
  provider: z.string(),
  version: z.string().optional(),
  codeSnippet: z.string(),
  summary: z.string().optional(),
  files: z
    .array(
      z.object({
        filename: z.string(),
        linesCount: z.number(),
      }),
    )
    .optional(),
});

export const componentSchemas = {
  approval_request: approvalRequestSchema,
  architecture_summary: architectureSummarySchema,
  artifact_viewer: artifactViewerSchema,
  chat_message: chatMessageSchema,
  clarification_question: clarificationQuestionSchema,
  cloud_state: cloudStateSchema,
  compute_plan: computePlanSchema,
  container_card: containerCardSchema,
  cost_estimate: costEstimateSchema,
  database_config: databaseConfigSchema,
  database_engine_selector: databaseEngineSelectorSchema,
  drift_status: driftStatusSchema,
  execution_timeline: executionTimelineSchema,
  loadbalancer_card: loadbalancerCardSchema,
  monitoring_card: monitoringCardSchema,
  networking_topology: networkingTopologySchema,
  policy_result: policyResultSchema,
  region_selector: regionSelectorSchema,
  resource_table: resourceTableSchema,
  security_warning: securityWarningSchema,
  storage_card: storageCardSchema,
  terraform_plan_diff: terraformPlanDiffSchema,
  terraform_review: terraformReviewSchema,
} as const;

/** Schema contract version carried by component envelopes. */
export const COMPONENT_SCHEMA_VERSION = "1.0.0" as const;

/** Keep the current schemas addressable by version so older payloads can retain their validator. */
export const componentSchemasByVersion = Object.fromEntries(
  Object.entries(componentSchemas).map(([type, schema]) => [type, { [COMPONENT_SCHEMA_VERSION]: schema }]),
) as {
  readonly [Type in keyof typeof componentSchemas]: Readonly<Record<typeof COMPONENT_SCHEMA_VERSION, (typeof componentSchemas)[Type]>>;
};
