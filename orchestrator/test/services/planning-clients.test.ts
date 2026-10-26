import { describe, expect, it, vi } from "vitest";
import { PlanningClients } from "../../src/services/planning-clients";
import { makeRun, manifest } from "../helpers/planning-fixture";

function clientsReturning(result: unknown) {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(result), { status: 200 }));
  const clients = new PlanningClients({ agentUrl: "http://agent", cloudAccountUrl: "http://cloud",
    policyUrl: "http://policy", mcpUrl: "http://mcp", manifestUrl: "http://state",
    serviceToken: "test-only-token" }, fetcher);
  return { clients, fetcher };
}

describe("MCP manifest validation contract", () => {
  it("passes structured field errors back to the planning retry loop", async () => {
    const { clients, fetcher } = clientsReturning({ valid: false, errors: [{
      field: "region", code: "missing_region", message: "region is required", allowed_values: null,
    }] });
    expect(await clients.validateManifest(makeRun(), manifest)).toEqual({ valid: false,
      errors: ["region: missing_region: region is required"] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body.context.permissions).toContain("manifest:read");
  });

  it("retains compatibility with schema-only string errors", async () => {
    const { clients } = clientsReturning({ valid: false, errors: ["Invalid region"] });
    expect(await clients.validateManifest(makeRun(), manifest)).toEqual({ valid: false, errors: ["Invalid region"] });
  });

  it("runs both validators before accepting a draft", async () => {
    const { clients, fetcher } = clientsReturning({ valid: true, errors: [] });
    expect(await clients.validateManifest(makeRun(), manifest)).toEqual({ valid: true, errors: [] });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      "http://mcp/tools/validate_manifest", "http://mcp/tools/validate_manifest_schema",
    ]);
  });

  it.each([
    { valid: true, errors: [{ field: "region", code: "missing_region", message: "required" }] },
    { valid: false, errors: [] }, { valid: false },
    { valid: "true", errors: [] }, { valid: true, errors: [42] },
  ])("rejects malformed or contradictory verdicts: %j", async result => {
    const { clients } = clientsReturning(result);
    await expect(clients.validateManifest(makeRun(), manifest)).rejects.toThrow();
  });
});

describe("BE-B08 cloud capability contract", () => {
  it("uses only discovered regions and never imports raw account metadata", async () => {
    const run = makeRun();
    const { clients, fetcher } = clientsReturning({ workspace_id: run.workspaceId, accounts: [{
      id: run.workspaceId, provider: "aws", status: "active", account_alias: "Dev",
      available_regions: ["us-east-1"], checked_at: new Date().toISOString(), execution_ready: false,
      metadata: { secret: "DO_NOT_COPY" },
    }] });
    const context = await clients.loadCloudContext(run);
    expect(context.active_accounts[0]?.supported_regions).toEqual(["us-east-1"]);
    expect(context.active_accounts[0]?.quota_limits).toBeNull();
    expect(JSON.stringify(context)).not.toContain("DO_NOT_COPY");
    expect(fetcher.mock.calls[0]![0]).toBe("http://mcp/tools/get_cloud_account_capabilities");
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).context).toMatchObject({
      workspace_id: run.workspaceId, permissions: ["cloud:read"],
    });
  });

  it("rejects foreign workspace capability responses", async () => {
    const { clients } = clientsReturning({ workspace_id: makeRun().workspaceId, accounts: [] });
    await expect(clients.loadCloudContext(makeRun())).rejects.toThrow("planning service");
  });

  it("cannot draft against a provider whose live discovery failed", async () => {
    const run = makeRun();
    const { clients } = clientsReturning({ workspace_id: run.workspaceId, accounts: [{
      id: run.workspaceId, provider: "aws", status: "active", account_alias: "Dev",
      available_regions: [], checked_at: null, execution_ready: false,
    }] });
    await expect(clients.loadCloudContext(run)).rejects.toThrow("Connect a provider");
  });
});
