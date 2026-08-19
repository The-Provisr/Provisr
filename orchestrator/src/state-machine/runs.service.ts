import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { DbService } from "../db/db.service";

export function createRunsService(db: DbService): RunsService {
  return new RunsService(db);
}

export const ALL_RUN_STATES = [
  "received",
  "pending_policy",
  "pending_cloud_context",
  "pending_agent",
  "manifest_ready",
  "pending_iac",
  "plan_ready",
  "pending_policy_check",
  "pending_confirmation",
  "pending_approval",
  "pending_execution",
  "executing",
  "completed",
  "failed",
  "cancelled"
] as const;

export type RunState = typeof ALL_RUN_STATES[number];

export interface ProvisioningRun {
  id: string;
  sessionId: string;
  workspaceId: string;
  requesterId: string;
  state: RunState;
  stateVersion: number;
  prompt: string;
  manifestVersion: number | null;
  policyDecision: string | null;
  approvalStatus: string;
  executionStatus: string;
  idempotencyKey: string;
  correlationId: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export class RunsService {
  constructor(private readonly db: DbService) {}

  async createRun(sessionId: string, workspaceId: string, requesterId: string, prompt: string): Promise<ProvisioningRun> {
    const correlationId = randomUUID();
    const idempotencyKey = `run-${correlationId}`;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<ProvisioningRun>(
        `INSERT INTO provisr_state.provisioning_runs 
         (session_id, workspace_id, requester_id, prompt, correlation_id, idempotency_key, state, state_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'received', 0)
         RETURNING id, session_id as "sessionId", workspace_id as "workspaceId", requester_id as "requesterId",
                   state, state_version as "stateVersion", prompt, manifest_version as "manifestVersion",
                   policy_decision as "policyDecision", approval_status as "approvalStatus",
                   execution_status as "executionStatus", idempotency_key as "idempotencyKey",
                   correlation_id as "correlationId", error_code as "errorCode", error_message as "errorMessage",
                   created_at as "createdAt", updated_at as "updatedAt", completed_at as "completedAt"`,
        [sessionId, workspaceId, requesterId, prompt, correlationId, idempotencyKey]
      );
      
      const run = res.rows[0];
      if (!run) {
        throw new ConflictException("Failed to create run");
      }
      
      await client.query(
        `INSERT INTO provisr_audit.audit_events (workspace_id, actor_id, actor_type, action, resource_type, resource_id, event_data) 
         VALUES ($1, $2, 'user', 'run_created', 'provisioning_run', $3, $4)`,
        [workspaceId, requesterId, run.id, JSON.stringify({ state: 'received' })]
      );

      await client.query("COMMIT");
      return run;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async listRuns(workspaceId: string, sessionId?: string, status?: string): Promise<ProvisioningRun[]> {
    let q = `SELECT id, session_id as "sessionId", workspace_id as "workspaceId", requester_id as "requesterId",
                 state, state_version as "stateVersion", prompt, manifest_version as "manifestVersion",
                 policy_decision as "policyDecision", approval_status as "approvalStatus",
                 execution_status as "executionStatus", idempotency_key as "idempotencyKey",
                 correlation_id as "correlationId", error_code as "errorCode", error_message as "errorMessage",
                 created_at as "createdAt", updated_at as "updatedAt", completed_at as "completedAt"
             FROM provisr_state.provisioning_runs WHERE workspace_id = $1`;
    const params: unknown[] = [workspaceId];
    if (sessionId) {
      params.push(sessionId);
      q += ` AND session_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      q += ` AND state = $${params.length}`;
    }
    q += ` ORDER BY created_at DESC`;
    
    const res = await this.db.query<ProvisioningRun>(q, params);
    return res.rows;
  }

  async getRun(id: string, workspaceId: string): Promise<ProvisioningRun> {
    const res = await this.db.query<ProvisioningRun>(
      `SELECT id, session_id as "sessionId", workspace_id as "workspaceId", requester_id as "requesterId",
                 state, state_version as "stateVersion", prompt, manifest_version as "manifestVersion",
                 policy_decision as "policyDecision", approval_status as "approvalStatus",
                 execution_status as "executionStatus", idempotency_key as "idempotencyKey",
                 correlation_id as "correlationId", error_code as "errorCode", error_message as "errorMessage",
                 created_at as "createdAt", updated_at as "updatedAt", completed_at as "completedAt"
        FROM provisr_state.provisioning_runs WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId]
    );
    const run = res.rows[0];
    if (!run) throw new NotFoundException("Run not found");
    return run;
  }

  async transitionState(id: string, workspaceId: string, expectedVersion: number, newState: RunState, actorId: string): Promise<ProvisioningRun> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      
      const updateRes = await client.query<ProvisioningRun>(
        `UPDATE provisr_state.provisioning_runs 
         SET state = $1, state_version = state_version + 1, updated_at = now()
         WHERE id = $2 AND workspace_id = $3 AND state_version = $4
         RETURNING id, session_id as "sessionId", workspace_id as "workspaceId", requester_id as "requesterId",
                 state, state_version as "stateVersion", prompt, manifest_version as "manifestVersion",
                 policy_decision as "policyDecision", approval_status as "approvalStatus",
                 execution_status as "executionStatus", idempotency_key as "idempotencyKey",
                 correlation_id as "correlationId", error_code as "errorCode", error_message as "errorMessage",
                 created_at as "createdAt", updated_at as "updatedAt", completed_at as "completedAt"`,
        [newState, id, workspaceId, expectedVersion]
      );

      const run = updateRes.rows[0];
      if (!run) {
        throw new ConflictException("State conflict or run not found");
      }

      // Audit transition
      await client.query(
        `INSERT INTO provisr_audit.audit_events (workspace_id, actor_id, actor_type, action, resource_type, resource_id, event_data) 
         VALUES ($1, $2, 'user', 'run_transitioned', 'provisioning_run', $3, $4)`,
        [workspaceId, actorId, run.id, JSON.stringify({ state: run.state, stateVersion: run.stateVersion })]
      );
      
      // Outbox event (assuming provisr_events.events exists as per PRD OR-005)
      await client.query(
          `INSERT INTO provisr_events.events (id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, 'provisioning_run', $2, 'StateChangedEvent', $3)`,
           [randomUUID(), run.id, JSON.stringify({ state: run.state, version: run.stateVersion })]
      ).catch(e => console.error("Outbox failed:", e));

      await client.query('COMMIT');
      return run;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async cancelRun(id: string, workspaceId: string, actorId: string): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId);
    if (run.state === 'cancelled' || run.state === 'completed' || run.state === 'failed') {
      return run;
    }
    return this.transitionState(id, workspaceId, run.stateVersion, 'cancelled', actorId);
  }

  async confirmRun(
    id: string,
    workspaceId: string,
    actorId: string,
    _dto?: { manifestVersion?: string; planVersion?: string },
  ): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId);
    return this.transitionState(
      id,
      workspaceId,
      run.stateVersion,
      "pending_approval",
      actorId,
    );
  }

  async clarifyRun(
    id: string,
    workspaceId: string,
    actorId: string,
    _dto?: { answers?: Record<string, unknown> },
  ): Promise<ProvisioningRun> {
    const run = await this.getRun(id, workspaceId);
    // Move from clarification to pending_agent
    return this.transitionState(
      id,
      workspaceId,
      run.stateVersion,
      "pending_agent",
      actorId,
    );
  }
}
