import { Injectable } from "@nestjs/common";
import { ChatEventsService } from "./chat-events.service";
import { AuditService } from "./audit.service";
import { DbService } from "../db/db.service";

type DispatchResponse = { messages?: Array<{ role: "assistant" | "system" | "user"; content: string }>; tool_calls?: Array<{ tool_name: string; ok: boolean; summary?: string; error_code?: string }>; manifest_draft?: unknown };
type TurnRow = { turn_id: string; run_id: string; session_id: string; workspace_id: string; requester_id: string; correlation_id: string; prompt: string; status: "accepted" | "running" | "completed" | "failed" | "cancelled" };

@Injectable()
export class PlanningDispatchService {
  constructor(private readonly db: DbService, private readonly events: ChatEventsService, private readonly audit: AuditService) {}

  async process(turnId: string): Promise<void> {
    const turn = await this.claim(turnId);
    if (!turn) return;
    try {
      const result = await this.dispatch(turn);
      await this.complete(turn, result);
    } catch {
      await this.fail(turn);
    }
  }

  private async claim(turnId: string): Promise<TurnRow | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<TurnRow>(
        `SELECT t.id AS turn_id, r.id AS run_id, t.session_id, t.workspace_id, t.requester_id, t.correlation_id, r.prompt, t.status
         FROM provisr_state.chat_turns t JOIN provisr_state.provisioning_runs r ON r.id = t.provisioning_run_id
         WHERE t.id = $1 FOR UPDATE`, [turnId],
      );
      const turn = result.rows[0];
      if (!turn || turn.status !== "accepted") { await client.query("COMMIT"); return undefined; }
      await client.query("UPDATE provisr_state.chat_turns SET status = 'running', updated_at = now() WHERE id = $1", [turnId]);
      await client.query("UPDATE provisr_state.provisioning_runs SET state = 'pending_policy', updated_at = now() WHERE id = $1", [turn.run_id]);
      await client.query("INSERT INTO provisr_state.chat_turn_results (turn_id, run_id, status) VALUES ($1,$2,'running')", [turn.turn_id, turn.run_id]);
      await this.events.append({ sessionId: turn.session_id, workspaceId: turn.workspace_id, turnId: turn.turn_id, eventType: "planning.started", payload: { runId: turn.run_id } }, client);
      await this.audit.append({ workspaceId: turn.workspace_id, eventType: "run_created", actorId: turn.requester_id, actorType: "user", resourceType: "provisioning_run", resourceId: turn.run_id, payload: { turnId: turn.turn_id }, correlationId: turn.correlation_id }, client);
      await client.query("COMMIT");
      return turn;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async dispatch(turn: TurnRow): Promise<DispatchResponse> {
    const baseUrl = process.env.AGENT_API_URL;
    if (!baseUrl) throw new Error("agent dispatch is not configured");
    let last: DispatchResponse = {};
    const toolCalls: NonNullable<DispatchResponse["tool_calls"]> = [];
    for (const phase of ["pending_policy", "pending_cloud_context", "pending_agent"]) {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/runs/${turn.run_id}/dispatch`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ run_id: turn.run_id, session_id: turn.session_id, workspace_id: turn.workspace_id, user_id: turn.requester_id, correlation_id: turn.correlation_id, phase, prompt: turn.prompt }),
      });
      if (!response.ok) throw new Error("agent dispatch failed");
      last = await response.json() as DispatchResponse;
      if (last.tool_calls?.some((call) => !call.ok)) throw new Error("agent evidence unavailable");
      toolCalls.push(...(last.tool_calls ?? []));
    }
    return { ...last, tool_calls: toolCalls };
  }

  private async complete(turn: TurnRow, result: DispatchResponse): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const message of result.messages ?? []) {
        if (message.role === "assistant" || message.role === "system") await client.query(`INSERT INTO provisr_state.chat_messages (session_id, workspace_id, turn_id, role, content) VALUES ($1,$2,$3,$4,$5)`, [turn.session_id, turn.workspace_id, turn.turn_id, message.role, message.content]);
      }
      await client.query("UPDATE provisr_state.chat_turns SET status = 'completed', updated_at = now() WHERE id = $1", [turn.turn_id]);
      await client.query("UPDATE provisr_state.provisioning_runs SET state = 'manifest_ready', updated_at = now() WHERE id = $1", [turn.run_id]);
      await client.query("UPDATE provisr_state.chat_turn_results SET status = 'completed', result = $2, completed_at = now(), updated_at = now() WHERE turn_id = $1", [turn.turn_id, JSON.stringify(result)]);
      for (const tool of result.tool_calls ?? []) await this.audit.append({ workspaceId: turn.workspace_id, eventType: "tool_call", actorId: "agent", actorType: "agent", resourceType: "provisioning_run", resourceId: turn.run_id, payload: { tool: tool.tool_name, ok: tool.ok }, correlationId: turn.correlation_id }, client);
      if (result.manifest_draft) await this.audit.append({ workspaceId: turn.workspace_id, eventType: "manifest_created", actorId: "agent", actorType: "agent", resourceType: "provisioning_run", resourceId: turn.run_id, payload: { source: "agent" }, correlationId: turn.correlation_id }, client);
      await this.events.append({
        sessionId: turn.session_id,
        workspaceId: turn.workspace_id,
        turnId: turn.turn_id,
        eventType: "planning.completed",
        payload: {
          runId: turn.run_id,
          sessionId: turn.session_id,
          manifest: result.manifest_draft ?? null,
          policyAndCloudEvidence: (result.tool_calls ?? []).map((tool) => ({ tool: tool.tool_name, summary: tool.summary ?? null })),
          planStatus: "not_generated",
        },
      }, client);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async fail(turn: TurnRow): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE provisr_state.chat_turns SET status = 'failed', updated_at = now() WHERE id = $1", [turn.turn_id]);
      await client.query("UPDATE provisr_state.provisioning_runs SET state = 'failed', error_code = 'AGENT_DISPATCH_FAILED', error_message = 'Planning could not be completed.', updated_at = now() WHERE id = $1", [turn.run_id]);
      await client.query("UPDATE provisr_state.chat_turn_results SET status = 'failed', error_code = 'AGENT_DISPATCH_FAILED', error_message = 'Planning could not be completed.', updated_at = now() WHERE turn_id = $1", [turn.turn_id]);
      await this.audit.append({ workspaceId: turn.workspace_id, eventType: "error", actorId: "system", actorType: "system", resourceType: "provisioning_run", resourceId: turn.run_id, payload: { code: "AGENT_DISPATCH_FAILED" }, correlationId: turn.correlation_id }, client);
      await this.events.append({ sessionId: turn.session_id, workspaceId: turn.workspace_id, turnId: turn.turn_id, eventType: "planning.failed", payload: { runId: turn.run_id, code: "AGENT_DISPATCH_FAILED" } }, client);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
