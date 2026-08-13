import { describe, expect, it } from "vitest";
import { HttpPolicyRequirementsClient, PolicyServiceClientError } from "../../src/services/policy-service.client";

describe("HttpPolicyRequirementsClient", () => {
  it("normalizes the policy service payload to the pre-flight contract", async () => {
    const client = new HttpPolicyRequirementsClient("http://policy:8081", async () => new Response(JSON.stringify({
      requirements: {
        allowed_regions: ["us-east-1"], max_budget: 500, required_tags: { owner: "platform" },
        prohibited_resource_types: ["aws_iam_user"], required_encryption: true, required_backup: true,
      },
    }), { status: 200 }));
    await expect(client.getPolicyRequirements("workspace 1")).resolves.toEqual({
      allowedRegions: ["us-east-1"], maxBudget: 500, requiredTags: { owner: "platform" },
      prohibitedResourceTypes: ["aws_iam_user"], requiredEncryption: true, requiredBackup: true,
    });
  });

  it("rejects malformed policy responses", async () => {
    const client = new HttpPolicyRequirementsClient("http://policy:8081", async () => new Response("{}", { status: 200 }));
    await expect(client.getPolicyRequirements("workspace-1")).rejects.toThrow(PolicyServiceClientError);
  });
});
