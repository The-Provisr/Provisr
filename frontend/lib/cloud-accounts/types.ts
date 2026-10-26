export type CloudProviderId = "aws" | "azure" | "gcp";

/** Backend `account_status` enum values (cloud-account-service). */
export type CloudAccountStatus = "pending" | "active" | "failed" | "disconnected";

/**
 * Surface projection returned by the list endpoint. No decrypted metadata,
 * account id, or regions ever appear here.
 */
export type CloudAccount = {
  id: string;
  workspace_id: string;
  provider: string;
  label: string;
  status: CloudAccountStatus;
  verified_at?: string;
  created_at: string;
  updated_at: string;
};

/** Detail projection. Metadata is decrypted but secrets are redacted. */
export type CloudAccountDetail = CloudAccount & {
  metadata?: Record<string, unknown>;
};

/** BE-B08 capability account (safe projection from cloud-account-service). */
export type CapabilityAccount = {
  id: string;
  provider: string;
  status: string;
  account_alias: string;
  account_identity: string;
  default_region: string;
  available_regions: string[];
  supported_domains: string[];
  execution_ready: boolean;
  checked_at: string | null;
  warning?: string;
};

export type CloudCapabilities = {
  workspace_id: string;
  accounts: CapabilityAccount[];
};

export type ProviderMeta = {
  id: CloudProviderId;
  name: string;
  description: string;
  /** AWS is connectable today; Azure/GCP wait on FE-B08 / FE-B09. */
  connectable: boolean;
  comingSoonLabel?: string;
};

export const PROVIDER_META: Record<CloudProviderId, ProviderMeta> = {
  aws: {
    id: "aws",
    name: "Amazon Web Services",
    description: "Connect an AWS account using a delegated IAM role.",
    connectable: true,
  },
  azure: {
    id: "azure",
    name: "Microsoft Azure",
    description: "Connect an Azure subscription using a managed application.",
    connectable: false,
    comingSoonLabel: "Coming soon",
  },
  gcp: {
    id: "gcp",
    name: "Google Cloud",
    description: "Connect a GCP project using workload identity federation.",
    connectable: false,
    comingSoonLabel: "Coming soon",
  },
};

export const PROVIDERS: readonly CloudProviderId[] = ["aws", "azure", "gcp"];

/** The five visual states a provider card can be in. */
export type CardState =
  | "active"
  | "pending"
  | "failed"
  | "disconnected"
  | "not_connected";

export function cardStateFor(
  account: CloudAccount | undefined,
  provider: CloudProviderId,
): CardState {
  if (!account) {
    return "not_connected";
  }
  switch (account.status) {
    case "active":
      return "active";
    case "pending":
      return "pending";
    case "failed":
      return "failed";
    case "disconnected":
      return "disconnected";
    default:
      // Unknown status from a newer backend: treat conservatively as pending.
      void provider;
      return "pending";
  }
}

/** Error surfaced by the cloud-accounts client. `code` carries the orchestrator slug. */
export class CloudAccountError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CloudAccountError";
    this.status = status;
    this.code = code;
  }
}
