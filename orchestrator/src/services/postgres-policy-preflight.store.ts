import { SqlClient, SqlPool } from "../state-machine/postgres-workflow-transition.store";
import { PolicyPreflightStore, PolicyRequirements } from "./policy-preflight.service";

export interface PolicyPreflightAudit {
  workspaceId: string;
  runId: string;
  actorId: string;
  actorType: "user" | "agent" | "system";
  correlationId: string;
  eventType: "policy_preflight_loaded" | "policy_preflight_skipped";
  payload: Record<string, unknown>;
}

export interface PolicyPreflightAuditWriter {
  appendPolicyPreflightAudit(client: SqlClient, audit: PolicyPreflightAudit): Promise<void>;
}

function persistencePayload(requirements: PolicyRequirements): Record<string, unknown> {
  return {
    allowed_regions: requirements.allowedRegions,
    max_budget: requirements.maxBudget,
    required_tags: requirements.requiredTags,
    prohibited_resource_types: requirements.prohibitedResourceTypes,
    required_encryption: requirements.requiredEncryption,
    required_backup: requirements.requiredBackup,
  };
}

/** PostgreSQL store for the durable OR-008 policy snapshot and audit trail. */
export class PostgresPolicyPreflightStore implements PolicyPreflightStore {
  constructor(
    private readonly pool: SqlPool,
    private readonly audit: PolicyPreflightAuditWriter,
  ) {}

  async policiesEnabled(workspaceId: string): Promise<boolean> {
    const result = await this.pool.connect();
    try {
      const row = await result.query<{ policies_enabled: boolean }>(
        `SELECT COALESCE((settings ->> 'policies_enabled')::boolean, true) AS policies_enabled
         FROM provisr_identity.workspaces
         WHERE id = $1 AND deleted_at IS NULL`,
        [workspaceId],
      );
      return row.rows[0]?.policies_enabled ?? false;
    } finally {
      result.release();
    }
  }

  async persistRequirements(input: {
    runId: string;
    workspaceId: string;
    requirements: PolicyRequirements;
    actorId: string;
    actorType: "user" | "agent" | "system";
    correlationId: string;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const payload = persistencePayload(input.requirements);
      const result = await client.query<{ id: string }>(
        `UPDATE provisr_state.provisioning_runs
         SET policy_requirements = $1::jsonb,
             policy_requirements_loaded_at = now(),
             updated_at = now()
         WHERE id = $2 AND workspace_id = $3 AND state = 'POLICY_LOADED'
         RETURNING id`,
        [JSON.stringify(payload), input.runId, input.workspaceId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return false;
      }
      await this.audit.appendPolicyPreflightAudit(client, {
        workspaceId: input.workspaceId,
        runId: input.runId,
        actorId: input.actorId,
        actorType: input.actorType,
        correlationId: input.correlationId,
        eventType: "policy_preflight_loaded",
        payload,
      });
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordSkipped(input: {
    runId: string;
    workspaceId: string;
    actorId: string;
    actorType: "user" | "agent" | "system";
    correlationId: string;
    reason: "workspace_policies_disabled";
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.audit.appendPolicyPreflightAudit(client, {
        workspaceId: input.workspaceId,
        runId: input.runId,
        actorId: input.actorId,
        actorType: input.actorType,
        correlationId: input.correlationId,
        eventType: "policy_preflight_skipped",
        payload: { reason: input.reason },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
