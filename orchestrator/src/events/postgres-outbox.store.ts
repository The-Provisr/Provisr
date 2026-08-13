import { SqlPool } from "../state-machine/postgres-workflow-transition.store";
import { OutboxEvent, OutboxStore } from "./outbox-publisher.service";

interface OutboxRow {
  id: string;
  event_id: string;
  workspace_id: string;
  event_type: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  created_at: string;
  delivery_attempts: number;
}

function toOutboxEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    workspaceId: row.workspace_id,
    eventType: row.event_type,
    correlationId: row.correlation_id,
    payload: row.payload,
    createdAt: row.created_at,
    deliveryAttempts: row.delivery_attempts,
  };
}

/** PostgreSQL outbox with lease recovery for publisher crashes. */
export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly pool: SqlPool) {}

  async claimOldestPending(): Promise<OutboxEvent | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(
        `WITH next_event AS (
           SELECT id
           FROM provisr_events.sse_events
           WHERE (status = 'pending' AND next_attempt_at <= now())
              OR (status = 'publishing' AND locked_until <= now())
           ORDER BY created_at ASC, id ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE provisr_events.sse_events AS event
         SET status = 'publishing',
             delivery_attempts = delivery_attempts + 1,
             locked_until = now() + INTERVAL '30 seconds',
             updated_at = now()
         FROM next_event
         WHERE event.id = next_event.id
         RETURNING event.id, event.event_id::text, event.workspace_id, event.event_type,
                   event.correlation_id, event.payload, event.created_at, event.delivery_attempts`,
      );
      await client.query("COMMIT");
      return result.rows[0] ? toOutboxEvent(result.rows[0]) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markPublished(eventId: string): Promise<void> {
    await this.poolUpdate(
      `UPDATE provisr_events.sse_events
       SET status = 'sent', published_at = now(), locked_until = NULL, last_error = NULL, updated_at = now()
       WHERE event_id = $1::uuid AND status = 'publishing'`,
      [eventId],
    );
  }

  async reschedule(eventId: string, _attempt: number, nextAttemptAt: Date, error: string): Promise<void> {
    await this.poolUpdate(
      `UPDATE provisr_events.sse_events
       SET status = 'pending', next_attempt_at = $2, locked_until = NULL, last_error = $3, updated_at = now()
       WHERE event_id = $1::uuid AND status = 'publishing'`,
      [eventId, nextAttemptAt.toISOString(), error.slice(0, 2_000)],
    );
  }

  async markFailed(eventId: string, _attempt: number, error: string): Promise<void> {
    await this.poolUpdate(
      `UPDATE provisr_events.sse_events
       SET status = 'failed', locked_until = NULL, last_error = $2, updated_at = now()
       WHERE event_id = $1::uuid AND status = 'publishing'`,
      [eventId, error.slice(0, 2_000)],
    );
  }

  private async poolUpdate(sql: string, values: readonly unknown[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(sql, values);
    } finally {
      client.release();
    }
  }
}
