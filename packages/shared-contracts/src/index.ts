export const SCHEMA_VERSION = "manifest/v1.0";
export * from "./schemas/manifest";

export type CloudProvider = "aws" | "azure" | "gcp";
export const requestStatuses = [
  "received",
  "pending_agent",
  "pending_clarification",
  "policy_check",
  "pending_confirmation",
  "pending_approval",
  "provisioning",
  "live",
  "failed",
  "cancelled",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export interface ResourceManifest {
  schemaVersion: string;
  provider: CloudProvider;
  region: string;
  cloudAccountId: string;
  environment: string;
  resources: Array<{
    id: string;
    type: string;
    name: string;
    properties: Record<string, string>;
  }>;
  estimatedCostUsd: number;
}

export type ComponentType =
  | "chat_message"
  | "clarification_question"
  | "architecture_summary"
  | "compute_plan"
  | "container_card"
  | "networking_topology"
  | "database_config"
  | "database_engine_selector"
  | "storage_card"
  | "monitoring_card"
  | "loadbalancer_card"
  | "region_selector"
  | "resource_table"
  | "cost_estimate"
  | "policy_result"
  | "security_warning"
  | "terraform_review"
  | "terraform_plan_diff"
  | "approval_request"
  | "execution_timeline"
  | "cloud_state"
  | "drift_status"
  | "artifact_viewer";

export interface ComponentPayload<T = unknown> {
  type: ComponentType;
  version: string;
  requestId: string;
  data: T;
}
