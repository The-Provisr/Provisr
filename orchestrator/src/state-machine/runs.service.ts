import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, NotImplementedException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { DbService } from "../db/db.service";
import { AuditService } from "../services/audit.service";
import { PlanningClients, NoConnectedProviderError } from "../services/planning-clients";
import { PolicyDeniesAllRegionsError } from "../services/policy-service.client";
import { CloudContext, ClarificationQuestion, cloudContextSchema, questionSchema, validateAnswers, validateComponent, manifestComponents } from "../services/planning-contracts";
import { assertTransition, EMPTY_TRANSITION_CONDITIONS } from "./transitions";
import { WORKFLOW_STATES, WorkflowState, isTerminalWorkflowState } from "./workflow-state";

export const ALL_RUN_STATES = WORKFLOW_STATES;
export type RunState = WorkflowState;
export interface ProvisioningRun {
  id: string; sessionId: string; workspaceId: string; requesterId: string;
  state: RunState; stateVersion: number; prompt: string; manifestVersion: number | null;
  policyDecision: string | null; approvalStatus: string; executionStatus: string;
  idempotencyKey: string | null; correlationId: string; errorCode: string | null; errorMessage: string | null;
  createdAt: Date; updatedAt: Date; completedAt: Date | null;
  policyRequirements: Record<string, unknown> | null; policyRequirementsLoadedAt: Date | null;
  cloudContext: CloudContext | null; cloudContextLoadedAt: Date | null;
  agentSessionId: string | null; agentTurnPending: boolean; agentInput: string | null;
  currentQuestion: ClarificationQuestion | null; clarificationExpiresAt: Date | null;
  answersHistory: Array<{ question: ClarificationQuestion; answers: Record<string, unknown>; answeredAt: string; idempotencyKey: string }>;
  manifestValidationAttempts: number; manifestValidatedVersion: number | null; manifestConfirmedVersion: number | null; manifestConfirmedAt: Date | null;
}
const columns = {
  approvalStatus: "approval_status", policyDecision: "policy_decision", errorCode: "error_code", errorMessage: "error_message",
  policyRequirements: "policy_requirements", policyRequirementsLoadedAt: "policy_requirements_loaded_at",
  cloudContext: "cloud_context", cloudContextLoadedAt: "cloud_context_loaded_at", agentSessionId: "agent_session_id",
  agentTurnPending: "agent_turn_pending", agentInput: "agent_input", currentQuestion: "current_question",
  clarificationExpiresAt: "clarification_expires_at", answersHistory: "answers_history",
  manifestValidationAttempts: "manifest_validation_attempts", manifestVersion: "manifest_version",
  manifestValidatedVersion: "manifest_validated_version",
  manifestConfirmedVersion: "manifest_confirmed_version", manifestConfirmedAt: "manifest_confirmed_at",
} as const;
type RunUpdates = Partial<Pick<ProvisioningRun, keyof typeof columns>>;
const jsonColumns = new Set(["policyRequirements", "cloudContext", "currentQuestion", "answersHistory"]);
const projection = `id, session_id AS "sessionId", workspace_id AS "workspaceId", requester_id AS "requesterId",
  state, state_version AS "stateVersion", prompt, idempotency_key AS "idempotencyKey", correlation_id AS "correlationId",
  execution_status AS "executionStatus", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt",
  ${Object.entries(columns).map(([key, column]) => `${column} AS "${key}"`).join(", ")}`;

export function createRunsService(db: DbService, audit = new AuditService(db), clients?: PlanningClients): RunsService {
  return new RunsService(db, audit, clients);
}

/** Durable state owns gates; HTTP calls never hold row transactions open. */
export class RunsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private processing: Promise<void> | undefined;
  private expiring: Promise<void> | undefined;
  private readonly shutdown = new AbortController();
  private stopping = false;
  private readonly logger = new Logger(RunsService.name);
  constructor(private readonly db: DbService, private readonly audit = new AuditService(db), private readonly clients?: PlanningClients) {}

  onModuleInit(): void {
    if (!this.clients) return;
    this.timer = setInterval(() => {
      if (!this.stopping && !this.expiring) {
        this.expiring = this.expireClarifications().catch(() => {
          if (!this.stopping) this.logger.error({ message: "Clarification expiry poll failed", correlation_id: "planning-worker" });
        }).finally(() => { this.expiring = undefined; });
      }
      if (this.processing || this.stopping) return;
      this.processing = this.processPendingRuns().catch(() => {
        this.logger.error({ message: "Planning worker could not poll durable runs", correlation_id: "planning-worker" });
      }).finally(() => { this.processing = undefined; });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.shutdown.abort();
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([this.processing, this.expiring]);
  }

  private async assertMembership(workspaceId: string, userId: string, client: Pick<PoolClient, "query"> = this.db.pool): Promise<void> {
    const result = await client.query(`SELECT 1 FROM provisr_identity.memberships m JOIN provisr_identity.workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL`, [workspaceId, userId]);
    if (!result.rows[0]) throw new ForbiddenException("Workspace membership required");
  }

  async createRun(sessionId: string, workspaceId: string, requesterId: string, prompt: string, idempotencyKey: string = randomUUID()): Promise<ProvisioningRun> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await this.assertMembership(workspaceId, requesterId, client);
      await this.assertMutationPermission(client, workspaceId, requesterId);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`create_run:${workspaceId}:${requesterId}:${idempotencyKey}`]);
      const existing = await client.query<ProvisioningRun>(`SELECT ${projection} FROM provisr_state.provisioning_runs WHERE idempotency_key = $1`, [idempotencyKey]);
      if (existing.rows[0]) {
        const run = existing.rows[0];
        if (run.workspaceId !== workspaceId || run.requesterId !== requesterId || run.sessionId !== sessionId || run.prompt !== prompt) throw new ConflictException("Idempotency key already used for a different request");
        await client.query("COMMIT");
        return run;
      }
      const session = await client.query(`SELECT 1 FROM provisr_state.chat_sessions
        WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND status = 'active' FOR UPDATE`, [sessionId, workspaceId, requesterId]);
      if (!session.rows[0]) throw new NotFoundException("Chat session not found");
      const correlationId = randomUUID();
      const result = await client.query<ProvisioningRun>(`INSERT INTO provisr_state.provisioning_runs
        (session_id, workspace_id, requester_id, prompt, correlation_id, idempotency_key, state)
        VALUES ($1,$2,$3,$4,$5,$6,'RECEIVED') RETURNING ${projection}`, [sessionId, workspaceId, requesterId, prompt, correlationId, idempotencyKey]);
      const run = result.rows[0]!;
      await this.audit.append({ workspaceId, actorId: requesterId, actorType: "user", eventType: "run_created",
        resourceType: "provisioning_run", resourceId: run.id, payload: { sessionId }, correlationId }, client);
      await this.publish(client, run, "RunCreatedEvent", { run_id: run.id });
      await client.query("COMMIT");
      return run;
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async listRuns(workspaceId: string, sessionId?: string, status?: string, actorId?: string): Promise<ProvisioningRun[]> {
    if (actorId) await this.assertMembership(workspaceId, actorId);
    const params: unknown[] = [workspaceId];
    let where = "workspace_id = $1";
    if (sessionId) { params.push(sessionId); where += ` AND session_id = $${params.length}`; }
    if (status) { params.push(z.enum(WORKFLOW_STATES).parse(status)); where += ` AND state = $${params.length}`; }
    return (await this.db.query<ProvisioningRun>(`SELECT ${projection} FROM provisr_state.provisioning_runs WHERE ${where} ORDER BY created_at DESC LIMIT 50`, params)).rows;
  }
  async getRun(id: string, workspaceId: string, actorId?: string): Promise<ProvisioningRun> {
    if (actorId) await this.assertMembership(workspaceId, actorId);
    const result = await this.db.query<ProvisioningRun>(`SELECT ${projection} FROM provisr_state.provisioning_runs WHERE id = $1 AND workspace_id = $2`, [id, workspaceId]);
    if (!result.rows[0]) throw new NotFoundException("Run not found");
    return result.rows[0];
  }

  private conditions(run: ProvisioningRun) {
    return { ...EMPTY_TRANSITION_CONDITIONS,
      policiesEnabled: run.policyRequirements?.enabled !== false,
      policyRequirementsLoaded: Boolean(run.policyRequirementsLoadedAt),
      cloudContextLoaded: Boolean(run.cloudContextLoadedAt && run.cloudContext),
      clarificationCompleted: !run.currentQuestion && run.answersHistory.length > 0,
      manifestCreated: run.manifestVersion !== null,
      manifestValidationPassed: run.manifestVersion !== null && run.manifestValidatedVersion === run.manifestVersion,
      manifestConfirmed: run.manifestConfirmedVersion !== null && run.manifestConfirmedVersion === run.manifestVersion,
      policyCheckPassed: ["allow", "warn", "requires_approval"].includes(run.policyDecision ?? ""),
      // Manifest consent only unlocks IaC. A state label is never evidence
      // of plan consent; the execution workflow must supply that separately.
      confirmationCompleted: false,
      approvalRequired: run.approvalStatus !== "not_required", approvalCompleted: run.approvalStatus === "approved",
    };
  }
  private async assertMutationPermission(client: Pick<PoolClient, "query">, workspaceId: string, actorId: string, approval = false): Promise<void> {
    const roles = approval ? ["admin", "approver"] : ["admin", "engineer"];
    const result = await client.query(`SELECT 1 FROM provisr_identity.memberships WHERE workspace_id = $1 AND user_id = $2 AND role::text = ANY($3::text[])`, [workspaceId, actorId, roles]);
    if (!result.rows[0]) throw new ForbiddenException("Provisioning permission required");
  }
  async transitionState(id: string, workspaceId: string, expectedVersion: number, newState: RunState, actorId: string, updates: RunUpdates = {}): Promise<ProvisioningRun> {
    return this.mutate(id, workspaceId, expectedVersion, actorId, () => ({ state: newState, updates }));
  }
  private async mutate(id: string, workspaceId: string, expectedVersion: number, actorId: string,
    operation: (run: ProvisioningRun) => { state?: RunState; updates?: RunUpdates; eventType?: string; payload?: Record<string, unknown> }): Promise<ProvisioningRun> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<ProvisioningRun>(`SELECT ${projection} FROM provisr_state.provisioning_runs WHERE id = $1 AND workspace_id = $2 FOR UPDATE`, [id, workspaceId]);
      const run = current.rows[0];
      if (!run) throw new NotFoundException("Run not found");
      if (run.stateVersion !== expectedVersion) throw new ConflictException("State version conflict");
      const change = operation(run);
      if (actorId !== "orchestrator") await this.assertMutationPermission(client, workspaceId, actorId,
        run.state === "APPROVING" && change.state !== "CANCELLED");
      if (change.state) {
        try { assertTransition(run.state, change.state, this.conditions({ ...run, ...change.updates })); }
        catch (error) { throw new ConflictException((error as Error).message); }
      } else if (isTerminalWorkflowState(run.state)) throw new ConflictException("Run is terminal");
      const state = change.state ?? run.state;
      const values: unknown[] = [state, id, workspaceId, expectedVersion];
      const assignments = Object.entries(change.updates ?? {}).map(([key, value]) => {
        const column = columns[key as keyof typeof columns];
        if (!column) throw new Error("Unknown run update");
        values.push(jsonColumns.has(key) && value !== null ? JSON.stringify(value) : value);
        return `${column} = $${values.length}`;
      });
      const result = await client.query<ProvisioningRun>(`UPDATE provisr_state.provisioning_runs SET state = $1,
        state_version = state_version + 1, updated_at = now(),
        completed_at = CASE WHEN $1::provisr_state.run_state IN ('COMPLETED','FAILED','CANCELLED') THEN now() ELSE completed_at END
        ${assignments.length ? `, ${assignments.join(", ")}` : ""}
        WHERE id = $2 AND workspace_id = $3 AND state_version = $4 RETURNING ${projection}`, values);
      const updated = result.rows[0];
      if (!updated) throw new ConflictException("State version conflict");
      const payload = { run_id: id, from: run.state, to: state, state_version: updated.stateVersion,
        ...(state === "FAILED" ? { error_code: updated.errorCode, error_message: updated.errorMessage } : {}), ...change.payload };
      await this.audit.append({ workspaceId, actorId, actorType: actorId === "orchestrator" ? "system" : "user",
        eventType: change.state ? "state_transition" : "tool_call", resourceType: "provisioning_run", resourceId: id,
        correlationId: run.correlationId, payload }, client);
      await this.publish(client, updated, change.eventType ?? "StateChangedEvent", payload);
      await client.query("COMMIT");
      return updated;
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  private async publish(client: PoolClient, run: ProvisioningRun, type: string, payload: Record<string, unknown>): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('provisr_sse'), hashtext($1))", [run.workspaceId]);
    await client.query(`INSERT INTO provisr_events.sse_events (workspace_id, event_id, event_type, correlation_id, payload)
      VALUES ($1,$2,$3,$4,$5)`, [run.workspaceId, randomUUID(), type, run.correlationId, JSON.stringify(payload)]);
  }

  async cancelRun(id: string, workspaceId: string, actorId: string): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId, actorId);
    return isTerminalWorkflowState(run.state) ? run : this.transitionState(id, workspaceId, run.stateVersion, "CANCELLED", actorId);
  }
  async confirmRun(id: string, workspaceId: string, actorId: string, dto?: { manifestVersion?: string | undefined; planVersion?: string | undefined }): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId, actorId);
    const version = Number(dto?.manifestVersion?.replace(/^v/, ""));
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException("A valid manifest version is required");
    if (run.manifestConfirmedVersion === version && run.manifestVersion === version) return run;
    return this.mutate(id, workspaceId, run.stateVersion, actorId, current => {
      if (current.state !== "MANIFEST_VALIDATING" || current.manifestVersion !== version || current.manifestValidatedVersion !== version) throw new ConflictException("Only the active validated manifest version can be confirmed");
      return { state: "IAC_GENERATING", updates: { manifestConfirmedVersion: version, manifestConfirmedAt: new Date() },
        eventType: "ManifestConfirmedEvent", payload: { manifest_version: version } };
    });
  }
  async suspendRun(run: ProvisioningRun, payload: unknown): Promise<ProvisioningRun> {
    const question = questionSchema.parse(payload);
    return this.mutate(run.id, run.workspaceId, run.stateVersion, "orchestrator", () => ({
      state: "CLARIFYING", updates: { currentQuestion: question, clarificationExpiresAt: new Date(Date.now() + 3600000), agentTurnPending: false },
      eventType: "ClarificationQuestionEvent", payload: { question, component: { type: "clarification_question", version: "1.0.0", requestId: run.id,
        data: validateComponent("clarification_question", { id: run.id, question: question.question, inputType: "text" }) } },
    }));
  }
  async clarifyRun(id: string, workspaceId: string, actorId: string, dto?: { answers?: Record<string, unknown> | undefined; idempotencyKey?: string | undefined }): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId, actorId);
    const replay = dto?.idempotencyKey && run.answersHistory.find(a => a.idempotencyKey === dto.idempotencyKey);
    if (replay) {
      let normalized: Record<string, unknown>;
      try { normalized = validateAnswers(replay.question, dto?.answers); }
      catch { throw new ConflictException("Idempotency key already used for different answers"); }
      if (JSON.stringify(replay.answers) !== JSON.stringify(normalized)) throw new ConflictException("Idempotency key already used for different answers");
      return run;
    }
    if (run.state !== "CLARIFYING" || !run.currentQuestion || !run.clarificationExpiresAt) throw new ConflictException("Run is not waiting for clarification");
    if (new Date(run.clarificationExpiresAt).getTime() <= Date.now()) {
      await this.transitionState(id, workspaceId, run.stateVersion, "CANCELLED", "orchestrator");
      throw new ConflictException("Clarification expired");
    }
    let answers: Record<string, unknown>;
    try { answers = validateAnswers(run.currentQuestion, dto?.answers); }
    catch { throw new BadRequestException("Answers do not match the current question fields"); }
    const agentInput = JSON.stringify({ question: run.currentQuestion, answers });
    if (agentInput.length > 20000) throw new BadRequestException("Clarification answers are too large");
    try {
      return await this.mutate(id, workspaceId, run.stateVersion, actorId, current => {
      if (current.state !== "CLARIFYING" || !current.clarificationExpiresAt || new Date(current.clarificationExpiresAt).getTime() <= Date.now()) throw new ConflictException("Clarification expired or is no longer pending");
      return {
      state: "MANIFEST_CREATING", updates: { currentQuestion: null, clarificationExpiresAt: null,
        answersHistory: [...current.answersHistory, { question: current.currentQuestion!, answers, answeredAt: new Date().toISOString(), idempotencyKey: dto?.idempotencyKey ?? randomUUID() }],
        agentInput, agentTurnPending: true }, eventType: "ClarificationAnsweredEvent",
      };
      });
    } catch (error) {
      // Concurrent retries can both read CLARIFYING. Once one commits, the
      // other's state-version check fails; recognize that committed replay.
      if (!(error instanceof ConflictException) || !dto?.idempotencyKey) throw error;
      const latest = await this.getRun(id, workspaceId, actorId);
      const committed = latest.answersHistory.find(entry => entry.idempotencyKey === dto.idempotencyKey);
      if (!committed) throw error;
      let replayAnswers: Record<string, unknown>;
      try { replayAnswers = validateAnswers(committed.question, dto.answers); }
      catch { throw new ConflictException("Idempotency key already used for different answers"); }
      if (JSON.stringify(committed.answers) !== JSON.stringify(replayAnswers)) throw new ConflictException("Idempotency key already used for different answers");
      return latest;
    }
  }
  async reviseRun(id: string, workspaceId: string, actorId: string, prompt: string): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId, actorId);
    if (!["MANIFEST_CREATING", "MANIFEST_VALIDATING"].includes(run.state) || run.agentTurnPending) throw new ConflictException("Run cannot accept a revision now");
    return this.mutate(id, workspaceId, run.stateVersion, actorId, () => ({
      ...(run.state === "MANIFEST_VALIDATING" ? { state: "MANIFEST_CREATING" as const } : {}),
      updates: { agentInput: prompt, agentTurnPending: true, manifestConfirmedVersion: null, manifestConfirmedAt: null, manifestValidatedVersion: null, manifestValidationAttempts: 0 },
      eventType: "ManifestRevisionRequestedEvent",
    }));
  }
  async handleApprovalEvent(id: string, workspaceId: string, actorId: string, decision: "approved" | "rejected", reason?: string): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId, actorId);
    if (run.state !== "APPROVING") throw new ConflictException("Run is not waiting for approval");
    if (decision === "rejected" && !reason?.trim()) throw new ConflictException("Reason is required when rejecting an approval");
    // TODO(follow-up: persist plan confirmation and enable APPROVING → EXECUTING): plan consent is not
    // recorded yet, so confirmationCompleted is always false and an approval cannot start execution.
    if (decision === "approved") throw new NotImplementedException("Execution is not yet available: plan confirmation is not implemented, so an approved run cannot advance to EXECUTING.");
    return this.mutate(id, workspaceId, run.stateVersion, actorId, () => ({
      state: "MANIFEST_CREATING",
      updates: { approvalStatus: decision, policyDecision: null,
        manifestValidatedVersion: null, manifestConfirmedVersion: null, manifestConfirmedAt: null, manifestValidationAttempts: 0,
        agentInput: `Revise the proposal in response to the approval rejection: ${reason}`, agentTurnPending: true },
      eventType: "ApprovalDecisionEvent", payload: { decision, ...(reason ? { reason } : {}) },
    }));
  }

  async processPendingRuns(): Promise<void> {
    const result = await this.db.query<{ id: string; workspace_id: string }>(`SELECT id, workspace_id FROM provisr_state.provisioning_runs
      WHERE state IN ('RECEIVED','POLICY_LOADED','CLOUD_CONTEXT_LOADED') OR (state = 'MANIFEST_CREATING' AND agent_turn_pending)
      ORDER BY updated_at LIMIT 20`);
    for (const row of result.rows) { if (this.stopping) break; await this.processRun(row.id, row.workspace_id); }
  }
  async expireClarifications(): Promise<void> {
    const result = await this.db.query<{ id: string; workspace_id: string; state_version: number }>(`SELECT id, workspace_id, state_version
      FROM provisr_state.provisioning_runs WHERE state = 'CLARIFYING' AND clarification_expires_at <= now() LIMIT 100`);
    for (const run of result.rows) {
      if (this.stopping) return;
      try { await this.transitionState(run.id, run.workspace_id, run.state_version, "CANCELLED", "orchestrator"); }
      catch (error) { if (!(error instanceof ConflictException)) throw error; }
    }
  }
  /** Session lock serializes dispatch across processes and is released on crash. */
  async processRun(id: string, workspaceId: string): Promise<void> {
    const lock = await this.db.connect();
    let locked = false;
    try {
      const result = await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('provisr_planning'), hashtext($1)) AS locked", [id]);
      locked = result.rows[0]?.locked ?? false;
      if (!locked) return;
      let run = await this.getRun(id, workspaceId);
      if (run.state === "CLARIFYING") {
        if (run.clarificationExpiresAt && new Date(run.clarificationExpiresAt).getTime() <= Date.now()) await this.transitionState(id, workspaceId, run.stateVersion, "CANCELLED", "orchestrator");
        return;
      }
      if (!this.clients || isTerminalWorkflowState(run.state)) return;
      try {
        if (run.state === "RECEIVED") run = await this.transitionState(id, workspaceId, run.stateVersion, "POLICY_LOADED", "orchestrator");
        if (run.state === "POLICY_LOADED") {
          const settings = await this.db.query<{ enabled: boolean }>(`SELECT COALESCE((settings->>'policies_enabled')::boolean, true) AS enabled
            FROM provisr_identity.workspaces WHERE id = $1 AND deleted_at IS NULL`, [workspaceId]);
          if (!settings.rows[0]) throw new NotFoundException("Workspace not found");
          const enabled = settings.rows[0].enabled;
          const policy = enabled ? await this.clients.policy.getPolicyRequirements(workspaceId) : null;
          const requirements = { enabled, allowed_regions: policy?.allowedRegions ?? [], max_budget: policy?.maxBudget ?? null,
            required_tags: policy?.requiredTags ?? {}, prohibited_resource_types: policy?.prohibitedResourceTypes ?? [],
            required_encryption: policy?.requiredEncryption ?? false, required_backup: policy?.requiredBackup ?? false };
          run = await this.transitionState(id, workspaceId, run.stateVersion, "CLOUD_CONTEXT_LOADED", "orchestrator", { policyRequirements: requirements, policyRequirementsLoadedAt: new Date() });
        }
        if (run.state === "CLOUD_CONTEXT_LOADED") {
          const context = cloudContextSchema.parse(await this.clients.loadCloudContext(run));
          run = await this.transitionState(id, workspaceId, run.stateVersion, "MANIFEST_CREATING", "orchestrator", { cloudContext: context, cloudContextLoadedAt: new Date() });
        }
        if (run.state === "MANIFEST_CREATING" && run.agentTurnPending) await this.dispatchAgent(run);
      } catch (error) {
        if (this.stopping) return;
        if (error instanceof ConflictException) return;
        const current = await this.getRun(id, workspaceId);
        if (current.stateVersion !== run.stateVersion || isTerminalWorkflowState(current.state)) return;
        const userFacing = error instanceof NoConnectedProviderError || error instanceof PolicyDeniesAllRegionsError;
        await this.transitionState(id, workspaceId, run.stateVersion, "FAILED", "orchestrator", {
          errorCode: userFacing ? error.code : "PLANNING_FAILED", errorMessage: userFacing ? error.message : "Planning could not be completed. Please try again.",
        });
      }
    } finally {
      // A connection whose unlock failed may still hold the session lock; destroy it rather than pool it.
      let unlockError: Error | undefined;
      try { if (locked) await lock.query("SELECT pg_advisory_unlock(hashtext('provisr_planning'), hashtext($1))", [id]); }
      catch (error) { unlockError = error as Error; throw error; }
      finally { lock.release(unlockError); }
    }
  }
  private async dispatchAgent(initial: ProvisioningRun): Promise<void> {
    const clients = this.clients!;
    const signal = AbortSignal.any([AbortSignal.timeout(120000), this.shutdown.signal]);
    let run = initial;
    try {
      if (!run.policyRequirementsLoadedAt || !run.policyRequirements || !run.cloudContextLoadedAt || !run.cloudContext) throw new Error("Run context is incomplete");
      if (!run.agentSessionId) {
        const sessionId = await clients.createAgentSession(run, signal);
        run = await this.mutate(run.id, run.workspaceId, run.stateVersion, "orchestrator", () => ({ updates: { agentSessionId: sessionId }, eventType: "AgentSessionLinkedEvent" }));
      }
      let message = run.agentInput ?? run.prompt;
      for (;;) {
        const output = await clients.agentTurn(run, message, signal);
        if (output.type === "clarification_question") { await this.suspendRun(run, output.data); return; }
        if (output.type === "error") throw new Error("Agent returned error");
        if (output.type === "manifest_draft") {
          const validation = await clients.validateManifest(run, output.data.manifest);
          if (!validation.valid) {
            const attempts = run.manifestValidationAttempts + 1;
            if (attempts >= 3) {
              await this.transitionState(run.id, run.workspaceId, run.stateVersion, "FAILED", "orchestrator", {
                manifestValidationAttempts: attempts, errorCode: "MANIFEST_VALIDATION_FAILED",
                errorMessage: "The manifest could not be validated after three attempts.",
              });
              return;
            }
            run = await this.mutate(run.id, run.workspaceId, run.stateVersion, "orchestrator", () => ({ updates: { manifestValidationAttempts: attempts }, eventType: "ManifestValidationFailedEvent" }));
            message = `Revise the draft to fix these validation errors: ${JSON.stringify(validation.errors)}`;
            continue;
          }
          const version = await clients.storeManifest(run, output.data.manifest);
          const components = manifestComponents(output.data.manifest, run.id, version);
          await this.mutate(run.id, run.workspaceId, run.stateVersion, "orchestrator", () => ({ state: "MANIFEST_VALIDATING",
            updates: { manifestVersion: version, manifestValidatedVersion: version, agentTurnPending: false, agentInput: null, manifestConfirmedVersion: null, manifestConfirmedAt: null },
            eventType: "ManifestReadyEvent", payload: { manifest_version: version, message: output.data.message, components } }));
          return;
        }
        const payload = output.type === "component_payload"
          ? { component: { type: output.data.component_id, version: "1.0.0", requestId: run.id, data: validateComponent(output.data.component_id, output.data.payload) } }
          : output.data;
        await this.mutate(run.id, run.workspaceId, run.stateVersion, "orchestrator", () => ({ updates: { agentTurnPending: false, agentInput: null },
          eventType: output.type === "component_payload" ? "ComponentPayloadEvent" : "AssistantMessageEvent", payload }));
        return;
      }
    } catch (error) {
      if (this.stopping) return;
      if (error instanceof ConflictException) return;
      const current = await this.getRun(run.id, run.workspaceId);
      if (current.stateVersion !== run.stateVersion || isTerminalWorkflowState(current.state)) return;
      await this.transitionState(run.id, run.workspaceId, run.stateVersion, "FAILED", "orchestrator", {
        errorCode: signal.aborted ? "AGENT_TIMEOUT" : "AGENT_FAILED",
        errorMessage: signal.aborted ? "Agent request timed out after 120 seconds." : "The agent could not complete this request. Please try again.",
      });
    }
  }
}
