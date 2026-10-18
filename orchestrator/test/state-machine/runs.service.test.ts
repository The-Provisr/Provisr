import { ConflictException, NotImplementedException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunsService, createRunsService } from "../../src/state-machine/runs.service";
import { AuditService } from "../../src/services/audit.service";
import { questionSchema } from "../../src/services/planning-contracts";
import { PlanningClients } from "../../src/services/planning-clients";
import { makeRun, memoryDb, contextFor, fakeClients, manifest, policy } from "../helpers/planning-fixture";

afterEach(() => vi.useRealTimers());
describe("RunsService durable planning", () => {
  it("creates and audits a run with the canonical PostgreSQL state", async () => {
    const run = makeRun();
    const f = memoryDb(run);
    const service = createRunsService(f.db);
    expect(service).toBeInstanceOf(RunsService);
    expect((await service.createRun(run.sessionId, run.workspaceId, run.requesterId, run.prompt)).id).toBe(run.id);
    expect(f.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO provisr_state.provisioning_runs"))![0]).toContain("'RECEIVED'");
    expect(f.audits[0]![1]).toBe("run_created");
    expect(f.audits[0]![7]).toMatch(/^[a-f0-9]{64}$/);
    expect(f.events[0]!.type).toBe("RunCreatedEvent");
  });

  it.each(["INSERT INTO provisr_audit.audit_events", "INSERT INTO provisr_events.sse_events"])("rolls back when %s fails", async failSql => {
    const run = makeRun();
    const f = memoryDb(run, failSql);
    const service = new RunsService(f.db);
    await expect(service.transitionState(run.id, run.workspaceId, 0, "POLICY_LOADED", run.requesterId)).rejects.toThrow("Database write failure");
    expect(f.query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
    expect(f.current().state).toBe("RECEIVED");
    expect(f.release).toHaveBeenCalled();
  });

  it("rejects skipped states and stale versions", async () => {
    const run = makeRun();
    const service = new RunsService(memoryDb(run).db);
    await expect(service.transitionState(run.id, run.workspaceId, 0, "EXECUTING", run.requesterId)).rejects.toThrow("Illegal workflow transition");
    await expect(service.transitionState(run.id, run.workspaceId, 1, "POLICY_LOADED", run.requesterId)).rejects.toThrow("State version conflict");
  });

  it("blocks drafting until cloud and policy context are persisted", async () => {
    const run = makeRun({ state: "CLOUD_CONTEXT_LOADED" });
    const service = new RunsService(memoryDb(run).db);
    await expect(service.transitionState(run.id, run.workspaceId, 0, "MANIFEST_CREATING", run.requesterId)).rejects.toThrow("cloudContextLoaded");
  });

  it("never treats an approval state label as plan confirmation", async () => {
    const run = makeRun({ state: "APPROVING", approvalStatus: "approved", policyDecision: "allow" });
    await expect(new RunsService(memoryDb(run).db).transitionState(run.id, run.workspaceId, 0, "EXECUTING", "orchestrator")).rejects.toThrow("confirmationCompleted");
  });

  it("loads verified cloud context, strips credentials, and dispatches a full agent context", async () => {
    const run = makeRun();
    const f = memoryDb(run);
    const c = fakeClients(run, [{ type: "assistant_message", data: { message: "Ready to draft" } }]);
    const service = new RunsService(f.db, new AuditService(f.db), c.clients);
    await service.processRun(run.id, run.workspaceId);
    const stored = f.current();
    expect(stored.state).toBe("MANIFEST_CREATING");
    expect(stored.cloudContext?.active_accounts[0]?.supported_regions).toEqual(["us-east-1"]);
    expect(JSON.stringify(stored)).not.toContain("DO_NOT_COPY");
    const sessionRequest = c.fetcher.mock.calls.find(([url]) => String(url).endsWith("/v1/sessions"))!;
    expect(JSON.parse(sessionRequest[1]!.body as string).execution_context).toMatchObject({ workspace_id: run.workspaceId, user_id: run.requesterId, cloud_context: stored.cloudContext });
    expect(stored.agentSessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(stored.agentTurnPending).toBe(false);
    await service.processRun(run.id, run.workspaceId);
    expect(c.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/turns"))).toHaveLength(1);
  });

  it("fails safely without a connected verified provider", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [], { noProvider: true });
    await new RunsService(f.db, new AuditService(f.db), c.clients).processRun(run.id, run.workspaceId);
    expect(f.current()).toMatchObject({ state: "FAILED", errorMessage: "Connect a provider account to proceed." });
    expect(c.fetcher.mock.calls.some(([url]) => String(url).includes("/sessions"))).toBe(false);
  });

  it("snapshots the policy-service requirements before loading cloud context", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [{ type: "assistant_message", data: { message: "Ready to draft" } }]);
    await new RunsService(f.db, new AuditService(f.db), c.clients).processRun(run.id, run.workspaceId);
    expect(f.current().policyRequirements).toEqual({ enabled: true, allowed_regions: ["us-east-1"], max_budget: 500,
      required_tags: { owner: "*" }, prohibited_resource_types: [], required_encryption: true, required_backup: false });
  });

  it("treats an absent allowed_regions rule as unrestricted", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [{ type: "assistant_message", data: { message: "Ready to draft" } }], { policyResponse: {} });
    await new RunsService(f.db, new AuditService(f.db), c.clients).processRun(run.id, run.workspaceId);
    expect(f.current()).toMatchObject({ state: "MANIFEST_CREATING", policyRequirements: { allowed_regions: [] } });
  });

  it("fails before drafting when the allowed_regions rule allows no regions", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [], { policyResponse: { allowed_regions: [] } });
    await new RunsService(f.db, new AuditService(f.db), c.clients).processRun(run.id, run.workspaceId);
    expect(f.current()).toMatchObject({ state: "FAILED", errorCode: "POLICY_NO_ALLOWED_REGIONS" });
    expect(f.current().policyRequirements).toBeFalsy();
    expect(c.fetcher.mock.calls.some(([url]) => String(url).includes("/sessions"))).toBe(false);
  });

  it("suspends and resumes the existing agent session with validated answers", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [{ type: "clarification_question", data: { question: "Region?", fields: [{ name: "region", type: "string", options: ["us-east-1"] }] } },
      { type: "assistant_message", data: { message: "Thanks" } }]);
    const service = new RunsService(f.db, new AuditService(f.db), c.clients);
    await service.processRun(run.id, run.workspaceId);
    const suspended = f.current();
    expect(suspended.state).toBe("CLARIFYING");
    expect(suspended.clarificationExpiresAt!.getTime() - Date.now()).toBeGreaterThan(3590000);
    await expect(service.clarifyRun(run.id, run.workspaceId, run.requesterId, { answers: { region: "us-west-2" } })).rejects.toThrow("Answers do not match");
    const resumed = await service.clarifyRun(run.id, run.workspaceId, run.requesterId, { answers: { region: "us-east-1" }, idempotencyKey: "answer-1" });
    expect(resumed).toMatchObject({ id: run.id, state: "MANIFEST_CREATING", currentQuestion: null, agentSessionId: suspended.agentSessionId });
    expect(resumed.answersHistory).toHaveLength(1);
    await service.processRun(run.id, run.workspaceId);
    const turns = c.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/turns"));
    expect(String(turns[0]![0])).toBe(String(turns[1]![0]));
    expect(JSON.parse(turns[1]![1]!.body as string).message).toContain('"region":"us-east-1"');
    const replay = await service.clarifyRun(run.id, run.workspaceId, run.requesterId, { answers: { region: "us-east-1" }, idempotencyKey: "answer-1" });
    expect(replay.answersHistory).toHaveLength(1);
    await expect(service.clarifyRun(run.id, run.workspaceId, run.requesterId, { answers: { region: "us-west-2" }, idempotencyKey: "answer-1" })).rejects.toThrow("Idempotency key");
  });

  it("expires unanswered clarifications without dispatching the agent", async () => {
    const run = makeRun({ state: "CLARIFYING", currentQuestion: { question: "Region?", fields: [{ name: "answer", type: "string" }] }, clarificationExpiresAt: new Date(Date.now() - 1) });
    const f = memoryDb(run); const service = new RunsService(f.db);
    await service.processRun(run.id, run.workspaceId);
    expect(f.current().state).toBe("CANCELLED");
  });

  it("retries invalid drafts and stores only a validated immutable version", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, Array.from({ length: 3 }, () => ({ type: "manifest_draft", data: { message: "Draft", manifest } })), { invalidDrafts: 2 });
    const service = new RunsService(f.db, new AuditService(f.db), c.clients);
    await service.processRun(run.id, run.workspaceId);
    expect(f.current()).toMatchObject({ state: "MANIFEST_VALIDATING", manifestVersion: 1, manifestValidatedVersion: 1, manifestConfirmedVersion: null });
    expect(c.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/v1/manifests"))).toHaveLength(1);
    expect(c.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/turns"))).toHaveLength(3);
    expect(f.events.at(-1)).toMatchObject({ type: "ManifestReadyEvent", payload: { manifest_version: 1, components: [{ type: "architecture_summary" }, { type: "storage_card" }] } });
    await expect(service.transitionState(run.id, run.workspaceId, f.current().stateVersion, "IAC_GENERATING", run.requesterId)).rejects.toThrow("manifestConfirmed");
    await expect(service.confirmRun(run.id, run.workspaceId, run.requesterId, { manifestVersion: "v2" })).rejects.toThrow("active validated manifest");
    const confirmed = await service.confirmRun(run.id, run.workspaceId, run.requesterId, { manifestVersion: "v1" });
    expect(confirmed).toMatchObject({ state: "IAC_GENERATING", manifestConfirmedVersion: 1 });
    expect((await service.confirmRun(run.id, run.workspaceId, run.requesterId, { manifestVersion: "1" })).stateVersion).toBe(confirmed.stateVersion);
  });

  it("fails after three invalid drafts without storing any version", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, Array.from({ length: 3 }, () => ({ type: "manifest_draft", data: { message: "Draft", manifest } })), { invalidDrafts: 3 });
    await new RunsService(f.db, new AuditService(f.db), c.clients).processRun(run.id, run.workspaceId);
    expect(f.current()).toMatchObject({ state: "FAILED", manifestVersion: null });
    expect(c.fetcher.mock.calls.some(([url]) => String(url).endsWith("/v1/manifests"))).toBe(false);
  });

  it("revisions reuse the conversation and allocate the next version", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [{ type: "manifest_draft", data: { message: "Draft", manifest } }, { type: "manifest_draft", data: { message: "Revised", manifest } }]);
    const service = new RunsService(f.db, new AuditService(f.db), c.clients);
    await service.processRun(run.id, run.workspaceId);
    const session = f.current().agentSessionId;
    await service.reviseRun(run.id, run.workspaceId, run.requesterId, "Enable versioning");
    await service.processRun(run.id, run.workspaceId);
    expect(f.current()).toMatchObject({ manifestVersion: 2, agentSessionId: session, manifestConfirmedVersion: null });
  });

  it("rejects unknown component payloads, audits the failure, and publishes only the safe fallback", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [{ type: "component_payload", data: { component_id: "raw_html", payload: { html: "<script>" } } }]);
    await new RunsService(f.db, new AuditService(f.db), c.clients).processRun(run.id, run.workspaceId);
    expect(f.current()).toMatchObject({ state: "FAILED", errorCode: "COMPONENT_PAYLOAD_INVALID" });
    expect(f.events.some(e => e.type === "ComponentPayloadEvent")).toBe(false);
    expect(f.events.at(-1)).toMatchObject({ type: "ComponentPayloadRejectedEvent", payload: {
      component_type: "unknown", component_version: "1.0.0", validation_issues: [{ code: "unknown_component_or_version" }],
    } });
    expect(f.audits.at(-1)![1]).toBe("state_transition");
    expect(JSON.parse(f.audits.at(-1)![6] as string)).toMatchObject({ error_code: "COMPONENT_PAYLOAD_INVALID",
      component_type: "unknown", validation_issues: [{ code: "unknown_component_or_version" }] });
    expect(JSON.stringify(f.events)).not.toContain("<script>");
  });

  it("rejects producer-valid unsupported prerelease component versions through the safe fallback", async () => {
    const run=makeRun();const f=memoryDb(run);
    const c=fakeClients(run,[{type:"component_payload",data:{component_id:"chat_message",component_version:"1.0.0-beta",payload:{}}}]);
    await new RunsService(f.db,new AuditService(f.db),c.clients).processRun(run.id,run.workspaceId);
    expect(f.current().errorCode).toBe("COMPONENT_PAYLOAD_INVALID");
    expect(f.events.at(-1)).toMatchObject({type:"ComponentPayloadRejectedEvent",payload:{component_type:"chat_message",component_version:"unsupported"}});
  });

  it.each([true, false])("handles a committed concurrent clarification replay (same answers: %s)", async (same) => {
    const question = questionSchema.parse({ question: "Region?", fields: [{ name: "region", type: "string", options: ["us-east-1", "us-west-2"] }] });
    const stale = makeRun({ state: "CLARIFYING", currentQuestion: question, clarificationExpiresAt: new Date(Date.now() + 60000) });
    const latest = { ...stale, state: "MANIFEST_CREATING" as const, stateVersion: 1, currentQuestion: null,
      answersHistory: [{ question, answers: { region: "us-east-1" }, answeredAt: new Date().toISOString(), idempotencyKey: "race" }] };
    const f = memoryDb(latest);
    const service = new RunsService(f.db);
    vi.spyOn(service, "getRun").mockResolvedValueOnce(stale).mockResolvedValue(latest);
    const result = service.clarifyRun(stale.id, stale.workspaceId, stale.requesterId, { idempotencyKey: "race", answers: { region: same ? "us-east-1" : "us-west-2" } });
    if (same) await expect(result).resolves.toMatchObject({ stateVersion: 1 });
    else await expect(result).rejects.toBeInstanceOf(ConflictException);
    expect(f.events).toHaveLength(0);
  });

  it.each([true, false])("handles a committed concurrent clarification replay (same answers: %s)", async (same) => {
    const question = questionSchema.parse({ question: "Region?", fields: [{ name: "region", type: "string", options: ["us-east-1", "us-west-2"] }] });
    const stale = makeRun({ state: "CLARIFYING", currentQuestion: question, clarificationExpiresAt: new Date(Date.now() + 60000) });
    const latest = { ...stale, state: "MANIFEST_CREATING" as const, stateVersion: 1, currentQuestion: null,
      answersHistory: [{ question, answers: { region: "us-east-1" }, answeredAt: new Date().toISOString(), idempotencyKey: "race" }] };
    const f = memoryDb(latest);
    const service = new RunsService(f.db);
    vi.spyOn(service, "getRun").mockResolvedValueOnce(stale).mockResolvedValue(latest);
    const result = service.clarifyRun(stale.id, stale.workspaceId, stale.requesterId, { idempotencyKey: "race", answers: { region: same ? "us-east-1" : "us-west-2" } });
    if (same) await expect(result).resolves.toMatchObject({ stateVersion: 1 });
    else await expect(result).rejects.toBeInstanceOf(ConflictException);
    expect(f.events).toHaveLength(0);
  });

  it("discards agent output when cancellation wins during the HTTP request", async () => {
    const run = makeRun(); const f = memoryDb(run);
    const c = fakeClients(run, [{ type: "assistant_message", data: { message: "Stale output" } }]);
    const original = c.fetcher.getMockImplementation()!;
    const service = new RunsService(f.db, new AuditService(f.db), c.clients);
    c.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/turns")) await service.cancelRun(run.id, run.workspaceId, run.requesterId);
      return original(url, init);
    });
    await service.processRun(run.id, run.workspaceId);
    expect(f.current().state).toBe("CANCELLED");
    expect(f.events.some(event => event.type === "AssistantMessageEvent")).toBe(false);
  });

  it("fails an agent turn after 120 seconds", async () => {
    vi.useFakeTimers();
    const run = makeRun({ state: "MANIFEST_CREATING", policyRequirements: policy, policyRequirementsLoadedAt: new Date(), cloudContextLoadedAt: new Date(), agentSessionId: makeRun().id });
    run.cloudContext = contextFor(run);
    const f = memoryDb(run);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("Timeout")), { once: true });
    }));
    // AbortSignal.timeout uses the native timer; inject a fake-timer signal for this proof.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal;
    });
    const clients = new PlanningClients({ agentUrl: "http://agent", cloudAccountUrl: "http://cloud", policyUrl: "http://policy", mcpUrl: "http://mcp", manifestUrl: "http://state", serviceToken: "test" }, fetcher);
    const pending = new RunsService(f.db, new AuditService(f.db), clients).processRun(run.id, run.workspaceId);
    await vi.advanceTimersByTimeAsync(120000);
    await pending;
    expect(f.current()).toMatchObject({ state: "FAILED", errorCode: "AGENT_TIMEOUT" });
    timeout.mockRestore();
  });

  it("keeps terminal cancellation idempotent", async () => {
    const run = makeRun({ state: "COMPLETED" }); const f = memoryDb(run);
    expect((await new RunsService(f.db).cancelRun(run.id, run.workspaceId, run.requesterId)).state).toBe("COMPLETED");
    expect(f.audits).toHaveLength(0);
  });

  it("rejects an approved decision until plan confirmation is implemented", async () => {
    const run = makeRun({ state: "APPROVING", approvalStatus: "pending", policyDecision: "requires_approval" }); const f = memoryDb(run);
    await expect(new RunsService(f.db).handleApprovalEvent(run.id, run.workspaceId, run.requesterId, "approved")).rejects.toThrow(NotImplementedException);
    expect(f.current()).toMatchObject({ state: "APPROVING", approvalStatus: "pending" });
    expect(f.audits).toHaveLength(0);
  });

  it("still routes a rejected approval back to manifest revision", async () => {
    const run = makeRun({ state: "APPROVING", approvalStatus: "pending", policyDecision: "requires_approval",
      policyRequirements: policy, policyRequirementsLoadedAt: new Date(), cloudContextLoadedAt: new Date() });
    run.cloudContext = contextFor(run); const f = memoryDb(run);
    const updated = await new RunsService(f.db).handleApprovalEvent(run.id, run.workspaceId, run.requesterId, "rejected", "Too expensive");
    expect(updated).toMatchObject({ state: "MANIFEST_CREATING", approvalStatus: "rejected", agentTurnPending: true });
  });

  it("destroys the planning lock connection when the advisory unlock fails", async () => {
    const run = makeRun(); const f = memoryDb(run, "pg_advisory_unlock");
    await expect(new RunsService(f.db).processRun(run.id, run.workspaceId)).rejects.toThrow("Database write failure");
    expect(f.release).toHaveBeenCalledWith(expect.objectContaining({ message: "Database write failure" }));
  });

  it("returns the planning lock connection to the pool after a clean unlock", async () => {
    const run = makeRun(); const f = memoryDb(run);
    await new RunsService(f.db).processRun(run.id, run.workspaceId);
    expect(f.release).toHaveBeenCalledWith(undefined);
  });
});
