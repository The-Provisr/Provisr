import { z } from "zod";
import { HttpPolicyRequirementsClient } from "./policy-service.client";
import { agentEnvelopeSchema, agentResponseSchema, cloudAccountSchema, cloudContextSchema, CloudContext } from "./planning-contracts";
import type { ProvisioningRun } from "../state-machine/runs.service";

export interface PlanningConfig {
  agentUrl: string;
  cloudAccountUrl: string;
  policyUrl: string;
  mcpUrl: string;
  manifestUrl: string;
  serviceToken: string;
  policyServiceToken?: string;
}

/** URLs are resolved at app wiring time, never within business logic. */
export function loadPlanningConfig(env: NodeJS.ProcessEnv): PlanningConfig {
  if (!env.ORCHESTRATOR_SERVICE_TOKEN) throw new Error("ORCHESTRATOR_SERVICE_TOKEN is required");
  return {
    agentUrl: env.AGENT_URL ?? "http://localhost:5000",
    cloudAccountUrl: env.CLOUD_ACCOUNT_SERVICE_URL ?? "http://localhost:8089",
    policyUrl: env.POLICY_SERVICE_URL ?? "http://localhost:8081",
    mcpUrl: env.MCP_URL ?? "http://localhost:5100",
    manifestUrl: env.STATE_SERVICE_URL ?? "http://localhost:8082",
    serviceToken: env.ORCHESTRATOR_SERVICE_TOKEN,
    ...(env.POLICY_SERVICE_SECRET ? { policyServiceToken: env.POLICY_SERVICE_SECRET } : {}),
  };
}

export class PlanningDependencyError extends Error {
  readonly code = "PLANNING_DEPENDENCY_UNAVAILABLE";
  constructor(message = "A planning service is unavailable. Please try again.") { super(message); }
}
export class NoConnectedProviderError extends Error {
  readonly code = "PROVIDER_REQUIRED";
  constructor() { super("Connect a provider account to proceed."); }
}

export class PlanningClients {
  readonly policy: HttpPolicyRequirementsClient;
  constructor(private readonly config: PlanningConfig, private readonly fetcher: typeof fetch = fetch) {
    this.policy = new HttpPolicyRequirementsClient(config.policyUrl, fetcher, config.policyServiceToken);
  }

  private async request(base: string, path: string, run: ProvisioningRun, body?: unknown, signal = AbortSignal.timeout(15000)): Promise<unknown> {
    const response = await this.fetcher(`${base.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST", signal,
      headers: { "Content-Type": "application/json", "X-Request-ID": run.id,
        "X-Correlation-ID": run.correlationId,
        ...(base === this.config.manifestUrl || base === this.config.agentUrl ? { Authorization: `Bearer ${this.config.serviceToken}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Never copy upstream error bodies (which may contain secrets) into run errors.
    if (!response.ok) throw new PlanningDependencyError();
    return response.json();
  }

  async loadCloudContext(run: ProvisioningRun): Promise<CloudContext> {
    const query = `?workspace_id=${encodeURIComponent(run.workspaceId)}`;
    const body = z.object({ accounts: z.array(cloudAccountSchema) }).parse(
      await this.request(this.config.cloudAccountUrl, `/v1/cloud-accounts${query}`, run));
    if (body.accounts.some(a => a.workspace_id !== run.workspaceId)) throw new PlanningDependencyError();
    const active = body.accounts.filter(a => a.status === "active" && a.verified_at);
    if (!active.length) throw new NoConnectedProviderError();
    const accounts: CloudContext["active_accounts"] = [];
    for (const account of active) {
      const detail = cloudAccountSchema.extend({ metadata: z.object({
        supported_regions: z.array(z.string().min(1)).min(1),
        resource_counts: z.record(z.number().int().nonnegative()).nullish(),
        quota_limits: z.record(z.number().nonnegative()).nullish(),
      }) }).parse(await this.request(this.config.cloudAccountUrl, `/v1/cloud-accounts/${account.id}${query}`, run));
      if (detail.id !== account.id || detail.workspace_id !== run.workspaceId || detail.provider !== account.provider
        || detail.status !== "active" || !detail.verified_at) throw new PlanningDependencyError();
      // Whitelist capability fields. Account metadata can include cloud credentials.
      accounts.push({ ...account, supported_regions: detail.metadata.supported_regions,
        resource_counts: detail.metadata.resource_counts ?? null, quota_limits: detail.metadata.quota_limits ?? null });
    }
    return cloudContextSchema.parse({ connected_providers: [...new Set(accounts.map(a => a.provider))], active_accounts: accounts });
  }

  async createAgentSession(run: ProvisioningRun, signal: AbortSignal): Promise<string> {
    const body = z.object({ session: z.object({ session_id: z.string().uuid() }) }).parse(
      await this.request(this.config.agentUrl, "/v1/sessions", run, {
        organization_id: run.workspaceId, request_id: run.id,
        execution_context: { workspace_id: run.workspaceId, user_id: run.requesterId,
          policy_context: run.policyRequirements, cloud_context: run.cloudContext },
      }, signal));
    return body.session.session_id;
  }

  async agentTurn(run: ProvisioningRun, message: string, signal: AbortSignal) {
    if (!run.agentSessionId) throw new PlanningDependencyError();
    const { result } = agentResponseSchema.parse(await this.request(this.config.agentUrl,
      `/v1/sessions/${run.agentSessionId}/turns`, run, { message }, signal));
    if (result.request_id !== run.id) throw new PlanningDependencyError("Agent response could not be correlated to this run.");
    return agentEnvelopeSchema.parse(result);
  }

  context(run: ProvisioningRun) {
    return { workspace_id: run.workspaceId, user_id: run.requesterId, permissions: ["manifest:read", "manifest:write"],
      request_id: run.id, correlation_id: run.correlationId, session_id: run.sessionId,
      idempotency_key: `manifest:${run.id}:${run.stateVersion}` };
  }

  async validateManifest(run: ProvisioningRun, manifest: Record<string, unknown>): Promise<{ valid: boolean; errors: string[] }> {
    const errorSchema = z.union([z.string(), z.object({
      field: z.string(), code: z.string(), message: z.string(), allowed_values: z.array(z.unknown()).nullish(),
    }).transform(error => `${error.field}: ${error.code}: ${error.message}`)]);
    const schema = z.object({ valid: z.boolean(), errors: z.array(errorSchema).default([]) })
      .refine(result => result.valid === (result.errors.length === 0), "Contradictory validation result");
    for (const tool of ["validate_manifest", "validate_manifest_schema"]) {
      const result = schema.parse(await this.request(this.config.mcpUrl, `/tools/${tool}`, run,
        { context: this.context(run), manifest, cloud_context: run.cloudContext, policy_context: run.policyRequirements }));
      if (!result.valid) return result;
    }
    return { valid: true, errors: [] };
  }

  async storeManifest(run: ProvisioningRun, manifest: Record<string, unknown>): Promise<number> {
    const result = z.object({ version: z.number().int().positive() }).parse(await this.request(
      this.config.manifestUrl, "/v1/manifests", run,
      { context: this.context(run), run_id: run.id, expected_state_version: run.stateVersion, content: manifest }));
    return result.version;
  }

  async createManifest(run: ProvisioningRun, output: Record<string, unknown>): Promise<
    { valid: true; version: number } | { valid: false; errors: string[] }
  > {
    const response = z.union([
      z.object({ manifest_id: z.string().uuid(), version: z.number().int().positive(), url: z.string().url(),
        validation: z.object({ valid: z.literal(true) }) }),
      z.object({ valid: z.literal(false), errors: z.array(z.union([z.string(), z.object({
        field: z.string().optional(), message: z.string().optional(), code: z.string().optional(),
      })])).default([]) }),
    ]).parse(await this.request(this.config.mcpUrl, "/tools/create_manifest", run, {
      context: this.context(run), prompt: run.prompt,
      policies_enabled: run.policyRequirements?.enabled === true,
      policy_requirements: run.policyRequirements,
      cloud_context: run.cloudContext,
      clarifications: run.answersHistory,
      agent_output: output,
    }));
    if ("valid" in response) {
      return { valid: false, errors: response.errors.map(error => typeof error === "string" ? error : `${error.field ?? "manifest"}: ${error.message ?? error.code ?? "validation failed"}`) };
    }
    return { valid: true, version: response.version };
  }
}
