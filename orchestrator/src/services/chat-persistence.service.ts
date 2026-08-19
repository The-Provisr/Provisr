import { createHash, randomUUID } from "node:crypto";
import { ConflictError, NotFoundError } from "../common/errors/typed-errors";
import { DbService } from "../db/db.service";
import { ChatEventsService } from "./chat-events.service";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

export interface ChatSessionRecord {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  status: "active" | "archived" | "deleted";
  runIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  turnId: string;
  role: "user" | "assistant" | "system";
  content: string;
  componentPayloads: Record<string, unknown>[];
  createdAt: string;
}

type SessionRow = {
  id: string; workspace_id: string; user_id: string; title: string;
  status: ChatSessionRecord["status"]; run_ids: string[]; created_at: string; updated_at: string;
};

export function createChatPersistenceService(
  db: DbService,
  events: ChatEventsService,
): ChatPersistenceService {
  return new ChatPersistenceService(db, events);
}

export class ChatPersistenceService {
  constructor(private readonly db: DbService, private readonly events: ChatEventsService) {}

  async listSessions(workspaceId: string, userId: string, limit = 50, offset = 0): Promise<ChatSessionRecord[]> {
    const result = await this.db.query<SessionRow>(
      `SELECT s.id, s.workspace_id, s.user_id, s.title, s.status, s.created_at, s.updated_at,
              COALESCE(array_agg(r.id) FILTER (WHERE r.id IS NOT NULL), '{}') as run_ids
       FROM provisr_state.chat_sessions s
       LEFT JOIN provisr_state.provisioning_runs r ON s.id = r.session_id
       WHERE s.workspace_id = $1 AND s.user_id = $2 AND s.status = 'active'
       GROUP BY s.id
       ORDER BY s.updated_at DESC
       LIMIT $3 OFFSET $4`, [workspaceId, userId, limit, offset],
    );
    return result.rows.map(toSession);
  }

  async createSession(params: { workspaceId: string; userId: string; title?: string }): Promise<ChatSessionRecord> {
    await this.assertMembership(params.workspaceId, params.userId);
    const result = await this.db.query<SessionRow>(
      `INSERT INTO provisr_state.chat_sessions (workspace_id, user_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, workspace_id, user_id, title, status, created_at, updated_at`,
      [params.workspaceId, params.userId, params.title?.trim() || "New request"],
    );
    return toSession({ ...result.rows[0]!, run_ids: [] });
  }

  async getSession(id: string, workspaceId: string, userId: string): Promise<ChatSessionRecord> {
    const result = await this.db.query<SessionRow>(
      `SELECT s.id, s.workspace_id, s.user_id, s.title, s.status, s.created_at, s.updated_at,
              COALESCE(array_agg(r.id) FILTER (WHERE r.id IS NOT NULL), '{}') as run_ids
       FROM provisr_state.chat_sessions s
       LEFT JOIN provisr_state.provisioning_runs r ON s.id = r.session_id
       WHERE s.id = $1 AND s.workspace_id = $2 AND s.user_id = $3 AND s.status = 'active'
       GROUP BY s.id`,
      [id, workspaceId, userId],
    );
    if (!result.rows[0]) throw new NotFoundError("chat session");
    return toSession(result.rows[0]);
  }

  async deleteSession(id: string, workspaceId: string, userId: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await this.assertSessionOwner(id, workspaceId, userId, client);
      const runs = await client.query<{ state: string }>(
        `SELECT state FROM provisr_state.provisioning_runs
         WHERE session_id = $1 AND workspace_id = $2 AND state NOT IN ('completed', 'failed', 'cancelled', 'rejected')`,
        [id, workspaceId],
      );
      if (runs.rows.length > 0) {
        throw new ConflictError("Cannot delete session with active runs");
      }
      const result = await client.query(
        `UPDATE provisr_state.chat_sessions SET status = 'deleted', updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND status = 'active'`,
        [id, workspaceId, userId],
      );
      if (result.rowCount !== 1) throw new NotFoundError("chat session");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listMessages(sessionId: string, workspaceId: string, userId: string): Promise<ChatMessageRecord[]> {
    await this.getSession(sessionId, workspaceId, userId);
    const result = await this.db.query<{
      id: string; turn_id: string; role: ChatMessageRecord["role"]; content: string; component_payloads: Record<string, unknown>[]; created_at: string;
    }>(
      `SELECT id, turn_id, role, content, component_payloads, created_at FROM provisr_state.chat_messages
       WHERE session_id = $1 AND workspace_id = $2 ORDER BY created_at ASC, id ASC`, [sessionId, workspaceId],
    );
    return result.rows.map((row) => ({ id: row.id, turnId: row.turn_id, role: row.role, content: row.content, componentPayloads: row.component_payloads || [], createdAt: row.created_at }));
  }

  async getMessagePreview(sessionId: string, workspaceId: string, userId: string): Promise<ChatMessageRecord[]> {
    await this.getSession(sessionId, workspaceId, userId);
    const result = await this.db.query<{
      id: string; turn_id: string; role: ChatMessageRecord["role"]; content: string; component_payloads: Record<string, unknown>[]; created_at: string;
    }>(
      `SELECT id, turn_id, role, content, component_payloads, created_at FROM provisr_state.chat_messages
       WHERE session_id = $1 AND workspace_id = $2 ORDER BY created_at DESC, id DESC LIMIT 5`, [sessionId, workspaceId],
    );
    return result.rows.reverse().map((row) => ({ id: row.id, turnId: row.turn_id, role: row.role, content: row.content, componentPayloads: row.component_payloads || [], createdAt: row.created_at }));
  }

  async submitPlanningTurn(params: {
    sessionId: string; workspaceId: string; userId: string; prompt: string;
    clientMessageId: string; idempotencyKey: string;
  }): Promise<{ turnId: string; runId: string; replayed: boolean }> {
    const fingerprint = hash({ sessionId: params.sessionId, workspaceId: params.workspaceId, userId: params.userId, prompt: params.prompt, clientMessageId: params.clientMessageId });
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await this.assertMembership(params.workspaceId, params.userId, client);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`chat_turn:${params.workspaceId}:${params.userId}:${params.idempotencyKey}`],
      );
      const existing = await client.query<{ id: string; provisioning_run_id: string; request_fingerprint: string }>(
        `SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns
         WHERE workspace_id = $1 AND requester_id = $2 AND idempotency_key = $3`,
        [params.workspaceId, params.userId, params.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== fingerprint) throw new ConflictError("idempotency key was already used for a different request");
        await client.query("COMMIT");
        return { turnId: existing.rows[0].id, runId: existing.rows[0].provisioning_run_id, replayed: true };
      }
      await this.assertSessionOwner(params.sessionId, params.workspaceId, params.userId, client);
      const correlationId = randomUUID();
      const run = await client.query<{ id: string }>(
        `INSERT INTO provisr_state.provisioning_runs
         (session_id, workspace_id, requester_id, state, prompt, idempotency_key, correlation_id)
         VALUES ($1, $2, $3, 'received', $4, $5, $6) RETURNING id`,
        [params.sessionId, params.workspaceId, params.userId, params.prompt, hash({ ...params, fingerprint }), correlationId],
      );
      const turn = await client.query<{ id: string }>(
        `INSERT INTO provisr_state.chat_turns
         (session_id, workspace_id, requester_id, client_message_id, idempotency_key, request_fingerprint, input, correlation_id, provisioning_run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [params.sessionId, params.workspaceId, params.userId, params.clientMessageId, params.idempotencyKey, fingerprint, JSON.stringify({ kind: "text", text: params.prompt }), correlationId, run.rows[0]!.id],
      );
      await client.query(
        `INSERT INTO provisr_state.chat_messages (session_id, workspace_id, turn_id, role, content)
         VALUES ($1, $2, $3, 'user', $4)`, [params.sessionId, params.workspaceId, turn.rows[0]!.id, params.prompt],
      );
      await this.events.append({
        sessionId: params.sessionId,
        workspaceId: params.workspaceId,
        turnId: turn.rows[0]!.id,
        eventType: "turn.accepted",
        payload: { runId: run.rows[0]!.id },
      }, client);
      await client.query(`UPDATE provisr_state.chat_sessions SET updated_at = now() WHERE id = $1`, [params.sessionId]);
      await client.query("COMMIT");
      return { turnId: turn.rows[0]!.id, runId: run.rows[0]!.id, replayed: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error instanceof ConflictError) {
        throw error;
      }
      try {
        const fallback = await this.db.query<{ id: string; provisioning_run_id: string; request_fingerprint: string }>(
          `SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns
           WHERE workspace_id = $1 AND requester_id = $2 AND idempotency_key = $3`,
          [params.workspaceId, params.userId, params.idempotencyKey],
        );
        if (fallback.rows[0]) {
          if (fallback.rows[0].request_fingerprint !== fingerprint) {
            throw new ConflictError("idempotency key was already used for a different request");
          }
          return { turnId: fallback.rows[0].id, runId: fallback.rows[0].provisioning_run_id, replayed: true };
        }
      } catch (fallbackError) {
        if (fallbackError instanceof ConflictError) {
          throw fallbackError;
        }
      }
      throw error;
    } finally { client.release(); }
  }

  private async assertMembership(workspaceId: string, userId: string, client: Queryable = this.db.pool): Promise<void> {
    const result = await client.query(`SELECT 1 FROM provisr_identity.memberships WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
    if (!result.rows[0]) throw new NotFoundError("workspace membership");
  }

  private async assertSessionOwner(sessionId: string, workspaceId: string, userId: string, client: Queryable): Promise<void> {
    const result = await client.query(`SELECT 1 FROM provisr_state.chat_sessions WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND status = 'active' FOR UPDATE`, [sessionId, workspaceId, userId]);
    if (!result.rows[0]) throw new NotFoundError("chat session");
  }
}

function toSession(row: SessionRow): ChatSessionRecord {
  return { id: row.id, workspaceId: row.workspace_id, userId: row.user_id, title: row.title, status: row.status, runIds: row.run_ids || [], createdAt: row.created_at, updatedAt: row.updated_at };
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
