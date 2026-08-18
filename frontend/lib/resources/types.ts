export type ProviderId = "aws" | "azure" | "gcp";

export type ResourceStatus = "running" | "stopped" | "terminated" | "unknown";

export type ResourceMetadata = Record<
  string,
  string | number | boolean | string[]
>;

export type ResourceItem = {
  id: string;
  name: string;
  type: string;
  provider: ProviderId;
  region: string;
  status: ResourceStatus;
  drift: boolean;
  ownerRunId: string | null;
  lastSynced: string;
  tags: Record<string, string>;
  metadata: ResourceMetadata;
  expected?: ResourceMetadata;
  actual?: ResourceMetadata;
};

export type ResourceViewState = "loading" | "default" | "empty" | "error";

export type ResourceLoaderResult =
  | { success: true; data: ResourceItem[] }
  | { success: false; error: string };

export type ResourceSortKey = "name" | "region" | "lastSynced";

export const providerMeta: Record<
  ProviderId,
  { label: string; color: string }
> = {
  aws: { label: "AWS", color: "#FF9900" },
  azure: { label: "Azure", color: "#007FFF" },
  gcp: { label: "GCP", color: "#4285F4" },
};

export const statusLabel: Record<ResourceStatus, string> = {
  running: "Running",
  stopped: "Stopped",
  terminated: "Terminated",
  unknown: "Unknown",
};
