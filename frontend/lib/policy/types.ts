/**
 * FE-A09 policy configuration payloads.
 *
 * @migration When the backend policy endpoints land (BE-C01 policy service),
 * these types should be derived from the shared `policy_pack` / `policy_rule`
 * contracts in `@provisr/shared-contracts` instead of this local copy.
 */

export type PolicySeverity = "deny" | "warn" | "approval";

export type PolicyParameterType = "text" | "number" | "multi_select" | "boolean";

export type PolicyParameter = {
  key: string;
  label: string;
  type: PolicyParameterType;
  value: string | number | boolean | string[];
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
};

export type PolicyRule = {
  key: string;
  severity: PolicySeverity;
  description: string;
  enabled: boolean;
  /** Human-readable rule definition shown in the visual builder. */
  definition: string;
  parameters: PolicyParameter[];
  remediationHint: string;
  docsUrl?: string;
  regoSource: string;
};

export type PolicyPack = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  ruleCount: number;
  rules: PolicyRule[];
};

export type PolicyViewState = "loading" | "default" | "empty";

export type PolicyPackDraft = Pick<PolicyPack, "id" | "enabled"> & {
  rules: Array<Pick<PolicyRule, "key" | "enabled"> & { parameters: PolicyParameter[] }>;
};
