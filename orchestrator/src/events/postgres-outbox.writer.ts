import { SqlClient } from "../state-machine/postgres-workflow-transition.store";
import { StateChangedEvent } from "../state-machine/workflow-transition.service";

/** Inserts a StateChangedEvent using the caller's open transaction. */
export class PostgresOutboxWriter {
  async appendStateChangedOutboxEvent(client: SqlClient, event: StateChangedEvent): Promise<void> {
    await client.query(
      `INSERT INTO provisr_events.sse_events
         (workspace_id, event_id, event_type, correlation_id, payload)
       VALUES ($1, $2::uuid, $3, $4::uuid, $5::jsonb)`,
      [
        event.workspaceId,
        event.id,
        event.type,
        event.correlationId,
        JSON.stringify({
          run_id: event.runId,
          from: event.from,
          to: event.to,
          state_version: event.stateVersion,
          occurred_at: event.occurredAt,
        }),
      ],
    );
  }
}
