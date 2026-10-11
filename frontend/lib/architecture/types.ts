/**
 * FE-C04 architecture summary model.
 *
 * @migration When the FE-B05 SSE envelope lands, derive
 * `ArchitectureSummaryPayload` from the shared `architecture_summary` contract
 * (`ComponentType` in packages/shared-contracts/src/index.ts:36) instead of
 * keeping this local mirror.
 */

export type ArchitectureProvider = "aws" | "azure" | "gcp";

export type KnownArchitectureResourceType =
  | "compute"
  | "database"
  | "storage"
  | "network"
  | "monitoring"
  | "loadbalancer";

/** Unknown types render a fallback icon but never crash. */
export type ArchitectureResourceType = KnownArchitectureResourceType | (string & {});

export interface ArchitectureResourceSummary {
  type: ArchitectureResourceType;
  count: number;
}

export interface ArchitectureSummaryPayload {
  provider: ArchitectureProvider;
  region: string;
  environment: string;
  resourceCount: number;
  resources: ArchitectureResourceSummary[];
  assumptions: string[];
  unknowns: string[];
  warnings: string[];
}

export type ArchitectureSummaryState = "loading" | "default" | "empty";

export interface ArchitectureSummaryProps {
  payload?: ArchitectureSummaryPayload;
  state?: ArchitectureSummaryState;
  /**
   * FE-C03 seam: called with the unknown item so the chat page can open the
   * clarification question inline. Hidden when absent.
   */
  onClarify?: (unknown: string) => void;
}
