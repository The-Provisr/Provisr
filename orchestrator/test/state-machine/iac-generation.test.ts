import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunsService } from "../../src/state-machine/runs.service";
import { AuditService } from "../../src/services/audit.service";
import { iacIdempotencyKey, verifyIacArtifact } from "../../src/services/iac-contracts";
import { iacFixture } from "../helpers/iac-fixture";

afterEach(() => vi.restoreAllMocks());
describe("OR-013", () => {
  it("uses the actual MCP contract, persists progress and atomically links verified evidence before planning", async () => {
    const f = iacFixture();
    await f.process();
    expect(f.fetcher).toHaveBeenCalledOnce();
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe("http://mcp/tools/generate_iac");
    expect(JSON.parse(init!.body as string)).toEqual({ manifest_id: f.manifestId, context: {
      workspace_id: f.run.workspaceId, user_id: f.run.requesterId, permissions: ["iac:write"], request_id: f.run.id,
      correlation_id: f.run.correlationId, session_id: f.run.sessionId, idempotency_key: iacIdempotencyKey(f.run, f.manifestId),
    } });
    expect(init!.headers).toMatchObject({ "X-Correlation-ID": f.run.correlationId, "X-Request-ID": f.run.id });
    expect(f.db.current()).toMatchObject({ state: "PLAN_CREATING", iacArtifactId: f.artifact.iac_artifact_id });
    expect(f.db.events.map(event => event.payload.message).filter(Boolean)).toEqual(["Generating Terraform templates...", "Validating generated output..."]);
    expect(f.db.events.at(-1)).toMatchObject({ type: "StateChangedEvent", payload: { to: "PLAN_CREATING", manifest_version: 2, iac_artifact_id: f.artifact.iac_artifact_id } });
    expect(f.db.audits).toHaveLength(3);
    await f.process();
    expect(f.fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ manifestConfirmedVersion: null }, { manifestValidatedVersion: 1 }, { manifestVersion: 3 }, { manifestConfirmedAt: null }])("fails closed for mismatched consent: %j", async overrides => {
    const f = iacFixture();
    vi.spyOn(f.service, "getRun").mockImplementation(async () => ({ ...f.db.current(), ...overrides }));
    await f.process();
    expect(f.db.current()).toMatchObject({ state: "FAILED", errorCode: "IAC_MANIFEST_NOT_CONFIRMED", iacArtifactId: null });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(["manifest_id", "run_id", "workspace_id", "session_id", "iac_artifact_id", "hash", "manifest_version"])("rejects invalid %s provenance", async key => {
    const f = iacFixture();
    const invalid = { ...f.artifact, [key]: key === "manifest_version" ? 1 : randomUUID() };
    f.fetcher.mockResolvedValue(new Response(JSON.stringify(invalid)));
    await f.process();
    expect(f.db.current()).toMatchObject({ state: "FAILED", errorCode: "IAC_INVALID_ARTIFACT", iacArtifactId: null });
  });

  it("rejects missing or forged persisted artifact evidence even for a valid response", async () => {
    const f = iacFixture();
    const original = f.db.query.getMockImplementation()!;
    f.db.query.mockImplementation((sql, params) => sql.includes("SELECT a.generation") ? Promise.resolve({ rows: [] }) : original(sql, params));
    await f.process();
    expect(f.db.current()).toMatchObject({ state: "FAILED", errorCode: "IAC_INVALID_ARTIFACT" });
  });

  it("fails without a scoped immutable manifest", async () => {
    const f = iacFixture();
    const original = f.db.query.getMockImplementation()!;
    f.db.query.mockImplementation((sql, params) => sql.includes("SELECT m.id FROM") ? Promise.resolve({ rows: [] }) : original(sql, params));
    await f.process();
    expect(f.db.current()).toMatchObject({ state: "FAILED", errorCode: "IAC_MANIFEST_NOT_FOUND" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("blocks PLAN_CREATING when only an artifact ID is supplied", async () => {
    const f = iacFixture();
    await expect(f.service.transitionState(f.run.id, f.run.workspaceId, 0, "PLAN_CREATING", "orchestrator")).rejects.toThrow("iacGenerated");
    expect(f.db.current().state).toBe("IAC_GENERATING");
  });

  it.each(["malformed", "oversized"])("bounds and sanitizes %s responses", async kind => {
    const f = iacFixture();
    f.fetcher.mockResolvedValue(new Response(kind === "malformed" ? "SECRET" : "x".repeat(8 * 1024 * 1024 + 1)));
    await f.process();
    expect(f.db.current()).toMatchObject({ state: "FAILED", errorCode: "IAC_DEPENDENCY_UNAVAILABLE" });
    expect(JSON.stringify(f.db.events)).not.toContain("SECRET");
  });

  it.each([403, 404, 409, 422, 502])("sanitizes dependency status %s", async status => {
    const f = iacFixture();
    f.fetcher.mockResolvedValue(new Response("token=SECRET raw error", { status }));
    await f.process();
    expect(f.db.current()).toMatchObject({ state: "FAILED", errorCode: "IAC_DEPENDENCY_UNAVAILABLE" });
    expect(JSON.stringify(f.db.events)).not.toContain("SECRET");
  });

  it("sanitizes transport failures", async () => {
    const f = iacFixture(); f.fetcher.mockRejectedValue(new Error("credential=SECRET"));
    await f.process();
    expect(f.db.current().state).toBe("FAILED");
    expect(JSON.stringify(f.db.current())).not.toContain("SECRET");
  });

  it("times out without leaking upstream details", async () => {
    const f = iacFixture();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    f.fetcher.mockRejectedValue(new Error("SECRET"));
    await f.process();
    expect(f.db.current()).toMatchObject({ state: "FAILED", errorCode: "IAC_TIMEOUT" });
  });

  it("serializes concurrent workers", async () => {
    const f = iacFixture();
    await Promise.all([f.process(), f.process()]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.db.current().state).toBe("PLAN_CREATING");
  });

  it("drops late success or failure when cancellation wins", async () => {
    for (const fail of [false, true]) {
      const f = iacFixture();
      f.fetcher.mockImplementation(async () => {
        await f.service.cancelRun(f.run.id, f.run.workspaceId, f.run.requesterId);
        if (fail) throw new Error("SECRET");
        return new Response(JSON.stringify(f.artifact));
      });
      await f.process();
      expect(f.db.current()).toMatchObject({ state: "CANCELLED", iacArtifactId: null });
      expect(f.db.events.some(event => event.payload.to === "PLAN_CREATING")).toBe(false);
    }
  });

  it("replays the same generation key after shutdown/restart despite progress state versions", async () => {
    const f = iacFixture();
    f.fetcher.mockImplementationOnce(async () => { await f.service.onModuleDestroy(); throw new Error("shutdown"); });
    await f.process();
    expect(f.db.current().state).toBe("IAC_GENERATING");
    const restarted = new RunsService(f.db.db, new AuditService(f.db.db), f.clients);
    await restarted.processPendingRuns();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const keys = f.fetcher.mock.calls.map(([, init]) => JSON.parse(init!.body as string).context.idempotency_key);
    expect(new Set(keys).size).toBe(1);
    expect(f.db.current().state).toBe("PLAN_CREATING");
    expect(f.db.query.mock.calls.some(([sql]) => sql.includes("'IAC_GENERATING') OR"))).toBe(true);
  });

  it("rejects unsafe paths, corrupted bundles and missing modules", () => {
    const f = iacFixture();
    for (const update of [{ total_size: 1 }, { file_count: 1 }, { hash: "0".repeat(64) },
      { terraform_files: [{ path: "../main.tf", content: "bad" }] }, { file_list: ["main.tf"] }]) {
      expect(() => verifyIacArtifact({ ...f.artifact, ...update }, f.run, f.manifestId)).toThrow("could not be verified");
    }
  });
});
