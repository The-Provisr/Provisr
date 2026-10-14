import { describe, expect, it, vi } from "vitest";
import { PostgresPolicyPreflightStore } from "../../src/services/postgres-policy-preflight.store";
import type { SqlPool } from "../../src/state-machine/postgres-workflow-transition.store";

function storeReturning(rows: Array<{ policies_enabled: boolean }>) {
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows })), release })) } as unknown as SqlPool;
  return { store: new PostgresPolicyPreflightStore(pool, { appendPolicyPreflightAudit: vi.fn() }), release };
}

describe("PostgresPolicyPreflightStore.policiesEnabled", () => {
  it("returns the stored workspace setting", async () => {
    expect(await storeReturning([{ policies_enabled: false }]).store.policiesEnabled("ws")).toBe(false);
    expect(await storeReturning([{ policies_enabled: true }]).store.policiesEnabled("ws")).toBe(true);
  });

  it("fails closed when the workspace is missing", async () => {
    const { store, release } = storeReturning([]);
    await expect(store.policiesEnabled("missing")).rejects.toThrow("Workspace not found");
    expect(release).toHaveBeenCalled();
  });
});
