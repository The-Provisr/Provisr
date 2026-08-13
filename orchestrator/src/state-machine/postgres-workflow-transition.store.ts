import {
  ProvisioningRunSnapshot,
  StateChangedEvent,
  StateTransitionAudit,
  WorkflowTransitionStore,
} from "./workflow-transition.service";
import { WorkflowState } from "./workflow-state";

/** Minimal pg-compatible interfaces keep database infrastructure out of FSM logic. */
export interface SqlResult<Row> {
  rows: Row[];
}

export interface SqlClient {
  query<Row = never>(sql: string, values?: readonly unknown[]): Promise<SqlResult<Row>>;
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlClient>;
}

/** Audit and outbox writers receive the same client, so they cannot commit independently. */
export interface WorkflowTransactionWriters {
  appendStateTransitionAudit(client: SqlClient, audit: StateTransitionAudit): Promise<void>;
  appendStateChangedOutboxEvent(client: SqlClient, event: StateChangedEvent): Promise<void>;
}

interface RunRow {
  id: string;
  workspace_id: string;
  state: WorkflowState;
  state_version: number;
  correlation_id: string;
}

function toSnapshot(row: RunRow): ProvisioningRunSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    state: row.state,
    stateVersion: row.state_version,
    correlationId: row.correlation_id,
  };
}

/**
 * PostgreSQL implementation of OR-006 optimistic locking.
 *
 * The state update, audit event and durable outbox record share one database
 * transaction. A failed CAS returns null; failures while writing evidence roll
 * back the state update, preventing unaudited or unpublished transitions.
 */
export class PostgresWorkflowTransitionStore implements WorkflowTransitionStore {
  constructor(
    private readonly pool: SqlPool,
    private readonly writers: WorkflowTransactionWriters,
  ) {}

  async transitionAtomically(input: {
    runId: string;
    expectedState: WorkflowState;
    expectedStateVersion: number;
    nextState: WorkflowState;
    audit: StateTransitionAudit;
    event: StateChangedEvent;
  }): Promise<ProvisioningRunSnapshot | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<RunRow>(
        `UPDATE provisr_state.provisioning_runs
         SET state = $1::provisr_state.run_state,
             state_version = state_version + 1,
             updated_at = now(),
             completed_at = CASE WHEN $1::provisr_state.run_state IN ('COMPLETED', 'FAILED', 'CANCELLED')
                                 THEN now() ELSE completed_at END
         WHERE id = $2
           AND state = $3::provisr_state.run_state
           AND state_version = $4
         RETURNING id, workspace_id, state, state_version, correlation_id`,
        [input.nextState, input.runId, input.expectedState, input.expectedStateVersion],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }

      await this.writers.appendStateTransitionAudit(client, input.audit);
      await this.writers.appendStateChangedOutboxEvent(client, input.event);
      await client.query("COMMIT");
      return toSnapshot(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
