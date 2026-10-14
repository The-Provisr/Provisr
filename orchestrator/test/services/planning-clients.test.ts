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
