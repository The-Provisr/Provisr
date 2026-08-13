import { describe, expect, it } from "vitest";
import {
  PolicyPreflightService,
  PolicyPreflightStateError,
  PolicyPreflightStore,
  PolicyRequirements,
} from "../../src/services/policy-preflight.service";
import { ProvisioningRunSnapshot } from "../../src/state-machine/workflow-transition.service";

const run: ProvisioningRunSnapshot = {
  id: "run-1",
  workspaceId: "workspace-1",
  state: "POLICY_LOADED",
  stateVersion: 1,
  correlationId: "correlation-1",
};
const requirements: PolicyRequirements = {
  allowedRegions: ["us-east-1"],
  maxBudget: 500,
  requiredTags: { owner: "platform" },
  prohibitedResourceTypes: ["aws_iam_user"],
  requiredEncryption: true,
  requiredBackup: true,
};

function makeStore(enabled: boolean): { store: PolicyPreflightStore; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    store: {
      async policiesEnabled() { calls.push("enabled"); return enabled; },
      async persistRequirements() { calls.push("persist"); return true; },
      async recordSkipped() { calls.push("skip"); },
    },
  };
}

describe("OR-008 policy pre-flight", () => {
  it("loads and persists all policy constraints for a policy-enabled workspace", async () => {
    const fixture = makeStore(true);
    const service = new PolicyPreflightService(fixture.store, {
      async getPolicyRequirements() { fixture.calls.push("fetch"); return requirements; },
    });

    await expect(service.load({ run, actorId: "system", actorType: "system" })).resolves.toMatchObject({
      policiesEnabled: true,
      requirements,
      conditions: { policyRequirementsLoaded: true },
    });
    expect(fixture.calls).toEqual(["enabled", "fetch", "persist"]);
  });

  it("records an audit skip and does not fetch requirements when workspace policies are disabled", async () => {
    const fixture = makeStore(false);
    const service = new PolicyPreflightService(fixture.store, {
      async getPolicyRequirements() { throw new Error("must not fetch"); },
    });

    await expect(service.load({ run, actorId: "system", actorType: "system" })).resolves.toMatchObject({
      policiesEnabled: false,
      requirements: null,
    });
    expect(fixture.calls).toEqual(["enabled", "skip"]);
  });

  it("only runs after the workflow entered POLICY_LOADED", async () => {
    const fixture = makeStore(true);
    const service = new PolicyPreflightService(fixture.store, { async getPolicyRequirements() { return requirements; } });
    await expect(service.load({ run: { ...run, state: "RECEIVED" }, actorId: "system", actorType: "system" })).rejects.toThrow(
      PolicyPreflightStateError,
    );
  });
});
