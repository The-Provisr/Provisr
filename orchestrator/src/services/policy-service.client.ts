import { PolicyRequirements, PolicyRequirementsClient } from "./policy-preflight.service";

export class PolicyServiceClientError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** An enabled allowed_regions rule with no regions: no manifest can comply. */
export class PolicyDeniesAllRegionsError extends Error {
  readonly code = "POLICY_NO_ALLOWED_REGIONS";
  constructor() { super("Workspace policy allows no regions. Ask a workspace admin to update the allowed regions policy."); }
}

/**
 * BE-M02 projection (backend/internal/policy/projection.go). Fields are
 * `omitempty`, so an absent key means the workspace has no such rule. The one
 * exception is `allowed_regions`: an enabled rule is always present, so `[]`
 * means no region is allowed while an absent key means unrestricted.
 */
interface PolicyRequirementsResponse {
  allowed_regions?: unknown;
  max_monthly_budget_usd?: unknown;
  required_tags?: unknown;
  prohibited_resource_types?: unknown;
  required_encryption?: unknown;
  warnings?: unknown;
}

/** Required tag keys carry no mandated value; the agent treats "*" as "any non-blank value". */
export const ANY_TAG_VALUE = "*";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Backend policy-service adapter for MCP-003 get_policy_requirements. */
export class HttpPolicyRequirementsClient implements PolicyRequirementsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly serviceToken?: string,
  ) {}

  async getPolicyRequirements(workspaceId: string): Promise<PolicyRequirements> {
    const response = await this.fetcher(
      `${this.baseUrl.replace(/\/$/, "")}/v1/workspaces/${encodeURIComponent(workspaceId)}/policy-requirements`,
      {
        signal: AbortSignal.timeout(15_000),
        ...(this.serviceToken ? { headers: { Authorization: `Bearer ${this.serviceToken}` } } : {}),
      },
    );
    if (!response.ok) {
      throw new PolicyServiceClientError(`Policy service returned ${response.status}`);
    }
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new PolicyServiceClientError("Policy service returned an invalid requirements payload");
    }
    const requirements = body as PolicyRequirementsResponse;
    const allowedRegions = requirements.allowed_regions === undefined ? [] : requirements.allowed_regions;
    const maxBudget = requirements.max_monthly_budget_usd ?? null;
    const requiredTags = requirements.required_tags ?? [];
    const prohibitedResourceTypes = requirements.prohibited_resource_types ?? [];
    const requiredEncryption = requirements.required_encryption ?? false;
    if (
      !isStringArray(allowedRegions) ||
      (maxBudget !== null && (typeof maxBudget !== "number" || !Number.isFinite(maxBudget) || maxBudget <= 0)) ||
      !isStringArray(requiredTags) ||
      !isStringArray(prohibitedResourceTypes) ||
      typeof requiredEncryption !== "boolean" ||
      (requirements.warnings !== undefined && !isStringArray(requirements.warnings))
    ) {
      throw new PolicyServiceClientError("Policy service returned malformed requirements");
    }
    if (requirements.allowed_regions !== undefined && allowedRegions.length === 0) throw new PolicyDeniesAllRegionsError();
    return {
      allowedRegions,
      maxBudget,
      requiredTags: Object.fromEntries(requiredTags.map((tag) => [tag, ANY_TAG_VALUE])),
      prohibitedResourceTypes,
      requiredEncryption,
      // The policy engine has no backup rule yet.
      requiredBackup: false,
    };
  }
}
