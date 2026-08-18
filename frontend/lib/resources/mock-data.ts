import type { ProviderId, ResourceItem, ResourceLoaderResult } from "./types";

export const mockResources: ResourceItem[] = [
  {
    id: "aws-ecs-web-prod-service",
    name: "web-prod-service",
    type: "aws_ecs_service",
    provider: "aws",
    region: "us-east-1",
    status: "running",
    drift: false,
    ownerRunId: "run_8f2d91",
    lastSynced: "2026-08-13T08:15:00.000Z",
    tags: { workspace: "acme", env: "production", team: "platform" },
    metadata: {
      taskDefinition: "web-prod:42",
      desiredCount: 3,
      launchType: "FARGATE",
      platformVersion: "1.4",
    },
  },
  {
    id: "aws-rds-web-prod-db",
    name: "web-prod-db",
    type: "aws_rds_cluster",
    provider: "aws",
    region: "us-east-1",
    status: "running",
    drift: true,
    ownerRunId: "run_8f2d91",
    lastSynced: "2026-08-13T08:15:00.000Z",
    tags: { workspace: "acme", env: "production", team: "platform" },
    metadata: {
      engine: "postgres",
      storageGb: 200,
      multiAz: true,
      deletionProtection: true,
    },
    expected: {
      engine: "postgres",
      instanceClass: "db.r6g.large",
      multiAz: true,
      storageGb: 200,
    },
    actual: {
      engine: "postgres",
      instanceClass: "db.r6g.xlarge",
      multiAz: true,
      storageGb: 200,
    },
  },
  {
    id: "aws-alb-public-web",
    name: "public-web-alb",
    type: "aws_lb",
    provider: "aws",
    region: "us-east-1",
    status: "running",
    drift: true,
    ownerRunId: "run_44c0a7",
    lastSynced: "2026-08-13T07:52:00.000Z",
    tags: { workspace: "acme", env: "production", ingress: "public" },
    metadata: {
      scheme: "internet-facing",
      idleTimeoutSeconds: 60,
      securityGroupCount: 2,
    },
    expected: {
      scheme: "internet-facing",
      securityGroups: ["sg-0a1b2c3d"],
    },
    actual: {
      scheme: "internet-facing",
      securityGroups: ["sg-0a1b2c3d", "sg-9f8e7d6c"],
    },
  },
  {
    id: "aws-ec2-build-runner",
    name: "build-runner",
    type: "aws_instance",
    provider: "aws",
    region: "eu-west-1",
    status: "terminated",
    drift: false,
    ownerRunId: "run_b13e60",
    lastSynced: "2026-08-11T16:20:00.000Z",
    tags: { workspace: "acme", env: "staging", team: "platform" },
    metadata: { instanceType: "m5.large", ami: "ami-04d29b6f", spot: true },
  },
  {
    id: "azure-aks-staging",
    name: "staging-aks",
    type: "azurerm_kubernetes_cluster",
    provider: "azure",
    region: "eastus",
    status: "running",
    drift: false,
    ownerRunId: "run_5ea2c4",
    lastSynced: "2026-08-13T06:30:00.000Z",
    tags: { workspace: "acme", env: "staging" },
    metadata: { nodeCount: 3, skuTier: "Free", kubernetesVersion: "1.29" },
  },
  {
    id: "azure-vnet-shared",
    name: "shared-vnet",
    type: "azurerm_virtual_network",
    provider: "azure",
    region: "eastus",
    status: "unknown",
    drift: false,
    ownerRunId: null,
    lastSynced: "2026-08-12T10:05:00.000Z",
    tags: { workspace: "acme" },
    metadata: { addressSpace: "10.20.0.0/16", dnsServers: 0 },
  },
  {
    id: "gcp-bucket-data-lake",
    name: "acme-data-lake",
    type: "google_storage_bucket",
    provider: "gcp",
    region: "us-central1",
    status: "stopped",
    drift: false,
    ownerRunId: "run_7711fe",
    lastSynced: "2026-08-12T09:40:00.000Z",
    tags: { workspace: "acme", env: "production", data: "analytics" },
    metadata: {
      storageClass: "STANDARD",
      versioningEnabled: false,
      publicAccessPrevention: "enforced",
    },
  },
];

export const providerCounts = (resources: ResourceItem[]) =>
  (["aws", "azure", "gcp"] as ProviderId[])
    .map((provider) => ({
      provider,
      count: resources.filter((resource) => resource.provider === provider)
        .length,
    }))
    .filter((entry) => entry.count > 0);

export const driftCount = (resources: ResourceItem[]) =>
  resources.filter((resource) => resource.drift).length;

export const fetchResources = async (
  scenario?: "default" | "empty" | "error" | string | null
): Promise<ResourceLoaderResult> => {
  // Simulate asynchronous data retrieval
  await new Promise((resolve) => setTimeout(resolve, 200));

  if (scenario === "error") {
    return {
      success: false,
      error: "Failed to connect to cloud state provider. Please check your credentials and retry.",
    };
  }

  if (scenario === "empty") {
    return {
      success: true,
      data: [],
    };
  }

  return {
    success: true,
    data: mockResources,
  };
};