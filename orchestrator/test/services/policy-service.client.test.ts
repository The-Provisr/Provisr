import { describe, expect, it } from "vitest";
import { HttpPolicyRequirementsClient, PolicyDeniesAllRegionsError, PolicyServiceClientError } from "../../src/services/policy-service.client";

describe("HttpPolicyRequirementsClient", () => {
  it("normalizes the policy service payload to the pre-flight contract", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new HttpPolicyRequirementsClient("http://policy:8081/", async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        allowed_regions: ["us-east-1"], max_monthly_budget_usd: 500, required_tags: ["owner"],
        prohibited_resource_types: ["aws_iam_user"], required_encryption: true, warnings: [],
      }), { status: 200 });
    }, "service-secret");
    await expect(client.getPolicyRequirements("workspace 1")).resolves.toEqual({
      allowedRegions: ["us-east-1"], maxBudget: 500, requiredTags: { owner: "*" },
      prohibitedResourceTypes: ["aws_iam_user"], requiredEncryption: true, requiredBackup: false,
    });
    expect(calls[0]?.url).toBe("http://policy:8081/v1/workspaces/workspace%201/policy-requirements");
    expect(calls[0]?.init?.headers).toEqual({ Authorization: "Bearer service-secret" });
  });

  it("treats omitted fields as rules the workspace has not enabled", async () => {
    const client = new HttpPolicyRequirementsClient("http://policy:8081", async () => new Response("{}", { status: 200 }));
    await expect(client.getPolicyRequirements("workspace-1")).resolves.toEqual({
      allowedRegions: [], maxBudget: null, requiredTags: {},
      prohibitedResourceTypes: [], requiredEncryption: false, requiredBackup: false,
    });
  });

  it("denies every region when the allowed_regions rule is enabled with no regions", async () => {
    const client = new HttpPolicyRequirementsClient("http://policy:8081", async () => new Response(
      JSON.stringify({ allowed_regions: [] }), { status: 200 }));
    const error = await client.getPolicyRequirements("workspace-1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PolicyDeniesAllRegionsError);
    expect(error).toMatchObject({ code: "POLICY_NO_ALLOWED_REGIONS" });
  });

  it("rejects malformed policy responses", async () => {
    for (const body of ["[]", JSON.stringify({ allowed_regions: null }), JSON.stringify({ required_tags: { owner: "platform" } }), JSON.stringify({ max_monthly_budget_usd: "500" })]) {
      const client = new HttpPolicyRequirementsClient("http://policy:8081", async () => new Response(body, { status: 200 }));
      await expect(client.getPolicyRequirements("workspace-1")).rejects.toThrow(PolicyServiceClientError);
    }
  });

  it("surfaces policy service failures", async () => {
    const client = new HttpPolicyRequirementsClient("http://policy:8081", async () => new Response("", { status: 503 }));
    await expect(client.getPolicyRequirements("workspace-1")).rejects.toThrow("Policy service returned 503");
  });
});
