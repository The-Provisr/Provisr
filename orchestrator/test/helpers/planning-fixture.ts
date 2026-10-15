import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { DbService } from "../../src/db/db.service";
import type { ProvisioningRun } from "../../src/state-machine/runs.service";
import { PlanningClients } from "../../src/services/planning-clients";

export const policy = { enabled: true, allowed_regions: ["us-east-1"], max_budget: 500,
  required_tags: { owner: "platform" }, prohibited_resource_types: [], required_encryption: true, required_backup: true };
/** The policy-service (BE-M02) projection behind `policy`: flat, key-only tags, no backup rule. */
export const policyServiceResponse = { allowed_regions: ["us-east-1"], max_monthly_budget_usd: 500,
  required_tags: ["owner"], required_encryption: true };
export const manifest = { schema_version: "1.0", provider: "aws", region: "us-east-1", environment: "development",
  monthly_budget_usd: 100, tags: { owner: "platform" }, security: { encryption_enabled: true }, backup: { enabled: true },
  policy: { requirements_loaded: true, applied_constraints: ["allowed_regions", "max_budget", "required_tags", "required_encryption", "required_backup"] },
  resources: [{ type: "aws_s3", name: "test-provisr-bucket", versioning: true }] };
export function makeRun(overrides: Partial<ProvisioningRun> = {}): ProvisioningRun {
  return { id: randomUUID(), sessionId: randomUUID(), workspaceId: randomUUID(), requesterId: randomUUID(),
    state: "RECEIVED", stateVersion: 0, prompt: "Create a bucket", manifestVersion: null, policyDecision: null,
    approvalStatus: "not_required", executionStatus: "pending", idempotencyKey: randomUUID(), correlationId: randomUUID(),
    errorCode: null, errorMessage: null, createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    policyRequirements: null, policyRequirementsLoadedAt: null, cloudContext: null, cloudContextLoadedAt: null,
    agentSessionId: null, agentTurnPending: true, agentInput: null, currentQuestion: null, clarificationExpiresAt: null,
    answersHistory: [], manifestValidationAttempts: 0, manifestValidatedVersion: null, manifestConfirmedVersion: null, manifestConfirmedAt: null, ...overrides };
}
export function contextFor(run: ProvisioningRun) {
  return { connected_providers: ["aws" as const], active_accounts: [{ id: randomUUID(), workspace_id: run.workspaceId,
    provider: "aws" as const, label: "Test AWS", status: "active" as const, verified_at: new Date().toISOString(),
    supported_regions: ["us-east-1"], resource_counts: { aws_s3: 0 }, quota_limits: { aws_s3: 100 } }] };
}

/** Only database I/O is simulated; actual FSM, parsers and clients are exercised. */
export function memoryDb(initial: ProvisioningRun, failSql?: string) {
  let run = structuredClone(initial);
  let snapshot = structuredClone(run);
  const audits: unknown[][] = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (failSql && sql.includes(failSql)) throw new Error("Database write failure");
    if (sql === "BEGIN") snapshot = structuredClone(run);
    if (sql === "ROLLBACK") run = snapshot;
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("FROM provisr_identity.memberships") || sql.includes("SELECT 1 FROM provisr_state.chat_sessions")) return { rows: [{ role: "engineer" }] };
    if (sql.includes("AS enabled")) return { rows: [{ enabled: true }] };
    if (sql.includes("SELECT hash FROM")) return { rows: audits.length ? [{ hash: audits.at(-1)![7] }] : [] };
    if (sql.includes("INSERT INTO provisr_audit.audit_events")) audits.push(params);
    if (sql.includes("INSERT INTO provisr_events.sse_events")) events.push({ type: params[2] as string, payload: JSON.parse(params[4] as string) });
    if (sql.includes("INSERT INTO provisr_state.provisioning_runs")) return { rows: [run] };
    if (sql.includes("UPDATE provisr_state.provisioning_runs")) {
      if (params[3] !== run.stateVersion) return { rows: [] };
      for (const match of sql.matchAll(/(\w+) = \$(\d+)/g)) {
        if (Number(match[2]) < 5) continue;
        const key = match[1]!.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof ProvisioningRun;
        const value = params[Number(match[2]) - 1];
        (run as unknown as Record<string, unknown>)[key] = typeof value === "string" && ["answersHistory", "cloudContext", "policyRequirements", "currentQuestion"].includes(key) ? JSON.parse(value) : value;
      }
      run.state = params[0] as ProvisioningRun["state"];
      run.stateVersion++;
      return { rows: [structuredClone(run)] };
    }
    if (sql.includes("FROM provisr_state.provisioning_runs")) {
      if (sql.includes("idempotency_key =")) return { rows: [] };
      return { rows: [structuredClone(run)] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const db = { query, connect: vi.fn(async () => ({ query, release })), pool: { query } } as unknown as DbService;
  return { db, query, release, audits, events, current: () => structuredClone(run) };
}

export function fakeClients(run: ProvisioningRun, outputs: Array<{ type: string; data: unknown }>, options: { invalidDrafts?: number; noProvider?: boolean; policyResponse?: Record<string, unknown> } = {}) {
  let validationCalls = 0;
  let manifestVersion = 0;
  const cloud = contextFor(run);
  const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    let body: unknown;
    if (path.endsWith("/policy-requirements")) body = options.policyResponse ?? policyServiceResponse;
    else if (path === "/v1/cloud-accounts") body = { accounts: options.noProvider ? [] : cloud.active_accounts };
    else if (path.startsWith("/v1/cloud-accounts/")) body = { ...cloud.active_accounts[0], metadata: {
      supported_regions: ["us-east-1"], resource_counts: { aws_s3: 0 }, quota_limits: { aws_s3: 100 }, secret_access_key: "DO_NOT_COPY" } };
    else if (path === "/v1/sessions") body = { session: { session_id: randomUUID() } };
    else if (path.endsWith("/turns")) {
      const output = outputs.shift();
      if (!output) throw new Error("No test output remaining");
      body = { result: { ...output, version: "1.0.0", request_id: run.id, metadata: { confidence: 1, source: "llm_generated", warnings: [] } } };
    } else if (path === "/tools/validate_manifest") {
      const valid = ++validationCalls > (options.invalidDrafts ?? 0);
      body = { valid, errors: valid ? [] : ["region validation failed"] };
    }
    else if (path === "/tools/validate_manifest_schema") body = { valid: true, errors: [] };
    else if (path === "/v1/manifests") body = { version: ++manifestVersion };
    else throw new Error(`Unexpected test URL ${path}`);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const clients = new PlanningClients({ agentUrl: "http://agent", cloudAccountUrl: "http://cloud", policyUrl: "http://policy",
    mcpUrl: "http://mcp", manifestUrl: "http://state", serviceToken: "test-only-token" }, fetcher);
  return { clients, fetcher, cloud };
}
