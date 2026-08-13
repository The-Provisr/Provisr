import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async append(params: {
    workspaceId: string; eventType: "prompt_received" | "run_created" | "tool_call" | "manifest_created" | "error";
    actorId: string; actorType: "user" | "agent" | "system"; resourceType: string; resourceId: string;
    payload: Record<string, unknown>; correlationId: string;
  }, client: Queryable = this.db.pool): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('provisr_audit_chain'))");
    const previous = await client.query("SELECT hash FROM provisr_audit.audit_events ORDER BY seq DESC LIMIT 1 FOR UPDATE");
    const previousHash = previous.rows[0]?.hash ?? null;
    const payload = JSON.stringify(params.payload);
    const hash = createHash("sha256").update(`${previousHash ?? ""}|${params.workspaceId}|${params.eventType}|${params.resourceId}|${payload}|${params.correlationId}`).digest("hex");
    await client.query(
      `INSERT INTO provisr_audit.audit_events
       (workspace_id, event_type, actor_id, actor_type, resource_type, resource_id, payload, hash, previous_hash, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [params.workspaceId, params.eventType, params.actorId, params.actorType, params.resourceType, params.resourceId, payload, hash, previousHash, params.correlationId],
    );
  }
}
