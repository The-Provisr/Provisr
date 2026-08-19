import { NotFoundError } from "../common/errors/typed-errors";
import { DbService } from "../db/db.service";

type Queryable = { query: <Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: Row[] }> };

export interface DurableChatEvent {
  id: string;
  eventType: string;
  sequence: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function createChatEventsService(db: DbService): ChatEventsService {
  return new ChatEventsService(db);
}

export class ChatEventsService {
  constructor(private readonly db: DbService) {}

  async append(params: { sessionId: string; workspaceId: string; turnId?: string; eventType: string; payload?: Record<string, unknown> }, client: Queryable = this.db.pool): Promise<DurableChatEvent> {
    const sequence = await client.query<{ next_sequence: string }>(
      `INSERT INTO provisr_events.chat_event_sequences (workspace_id, next_sequence)
       VALUES ($1, 2)
       ON CONFLICT (workspace_id) DO UPDATE SET next_sequence = provisr_events.chat_event_sequences.next_sequence + 1
       RETURNING next_sequence - 1 AS next_sequence`, [params.workspaceId],
    );
    const result = await client.query<{ id: string; event_type: string; sequence: string; payload: Record<string, unknown>; created_at: string }>(
      `INSERT INTO provisr_events.chat_events (session_id, workspace_id, turn_id, sequence, event_type, payload)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, event_type, sequence, payload, created_at`,
      [params.sessionId, params.workspaceId, params.turnId ?? null, sequence.rows[0]!.next_sequence, params.eventType, JSON.stringify(params.payload ?? {})],
    );
    return toEvent(result.rows[0]!);
  }

  async listWorkspaceEvents(params: { workspaceId: string; userId: string; after: number }): Promise<DurableChatEvent[]> {
    const membership = await this.db.query(`SELECT 1 FROM provisr_identity.memberships WHERE workspace_id = $1 AND user_id = $2`, [params.workspaceId, params.userId]);
    if (!membership.rows[0]) throw new NotFoundError("workspace membership");
    const result = await this.db.query<{ id: string; event_type: string; sequence: string; payload: Record<string, unknown>; created_at: string }>(
      `SELECT id, event_type, sequence, payload, created_at FROM provisr_events.chat_events
       WHERE workspace_id = $1 AND sequence > $2 ORDER BY sequence ASC LIMIT 250`, [params.workspaceId, params.after],
    );
    return result.rows.map(toEvent);
  }
}

function toEvent(row: { id: string; event_type: string; sequence: string; payload: Record<string, unknown>; created_at: string }): DurableChatEvent {
  return { id: row.id, eventType: row.event_type, sequence: Number(row.sequence), payload: row.payload, createdAt: row.created_at };
}
