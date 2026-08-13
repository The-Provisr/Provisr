import { PolicyRequirements, PolicyRequirementsClient } from "./policy-preflight.service";

export class PolicyServiceClientError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface PolicyRequirementsResponse {
  requirements: {
    allowed_regions: unknown;
    max_budget: unknown;
    required_tags: unknown;
    prohibited_resource_types: unknown;
    required_encryption: unknown;
    required_backup: unknown;
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && Object.values(value).every((item) => typeof item === "string");
}

/** Backend policy-service adapter for MCP-003 get_policy_requirements. */
export class HttpPolicyRequirementsClient implements PolicyRequirementsClient {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async getPolicyRequirements(workspaceId: string): Promise<PolicyRequirements> {
    const response = await this.fetcher(
      `${this.baseUrl.replace(/\/$/, "")}/workspaces/${encodeURIComponent(workspaceId)}/policy-requirements`,
    );
    if (!response.ok) {
      throw new PolicyServiceClientError(`Policy service returned ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!this.isResponse(body)) throw new PolicyServiceClientError("Policy service returned an invalid requirements payload");
    const requirements = body.requirements;
    if (
      !isStringArray(requirements.allowed_regions) ||
      typeof requirements.max_budget !== "number" ||
      !isStringRecord(requirements.required_tags) ||
      !isStringArray(requirements.prohibited_resource_types) ||
      typeof requirements.required_encryption !== "boolean" ||
      typeof requirements.required_backup !== "boolean"
    ) {
      throw new PolicyServiceClientError("Policy service returned malformed requirements");
    }
    return {
      allowedRegions: requirements.allowed_regions,
      maxBudget: requirements.max_budget,
      requiredTags: requirements.required_tags,
      prohibitedResourceTypes: requirements.prohibited_resource_types,
      requiredEncryption: requirements.required_encryption,
      requiredBackup: requirements.required_backup,
    };
  }

  private isResponse(value: unknown): value is PolicyRequirementsResponse {
    return typeof value === "object" && value !== null && "requirements" in value;
  }
}
