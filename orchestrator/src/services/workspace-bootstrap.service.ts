import { HttpException } from "@nestjs/common";
import { z } from "zod";
import { DbService } from "../db/db.service";
import { DependencyError, ForbiddenError, ValidationError } from "../common/errors/typed-errors";
import type { RequestUser } from "../middleware/auth.types";
import { AuditService } from "./audit.service";

const workspaceSchema = z.object({ id: z.string().uuid(), name: z.string(), slug: z.string(), environment: z.enum(["dev", "staging", "prod"]) }).passthrough();
const environments = { development: "dev", staging: "staging", production: "prod" } as const;
type CreateInput = { name: string; description?: string | undefined; environment: keyof typeof environments; avatar?: string | undefined; providers?: string[] | undefined };
export type EnsureInput = { name?: string | null | undefined; email?: string | null | undefined; avatarUrl?: string | null | undefined; workspaceId?: string | null | undefined };

export class WorkspaceBootstrapService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly backendUrl: string) {}

  async workspaces(user: RequestUser, input?: CreateInput, key?: string) {
    if (input && (!key?.trim() || key.length > 128)) throw new ValidationError("A bounded Idempotency-Key is required");
    const endpoint = input ? "/workspaces" : `/workspaces?user_id=${encodeURIComponent(user.userId)}`;
    let response: Response;
    try {
      response = await fetch(`${this.backendUrl}${endpoint}`, {
        method: input ? "POST" : "GET", signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json", ...(input ? { "Idempotency-Key": key! } : {}) },
        ...(input ? { body: JSON.stringify({ ...input, environment: environments[input.environment], creator_id: user.userId }) } : {}),
      });
    } catch { throw new DependencyError("Workspace service unavailable"); }
    let body: unknown;
    try { body = await response.json(); } catch { throw new DependencyError("Workspace service returned an unreadable response"); }
    if (!response.ok) {
      const parsed = z.object({ error: z.string(), message: z.string() }).safeParse(body);
      if (response.status >= 500 || !parsed.success) throw new DependencyError("Workspace service unavailable");
      throw new HttpException({ message: parsed.data.message, code: parsed.data.error }, response.status);
    }
    const parsed = (input ? workspaceSchema : z.array(workspaceSchema.extend({ role: z.enum(["admin", "engineer", "approver", "auditor", "viewer"]) }))).safeParse(body);
    if (!parsed.success) throw new DependencyError("Workspace service returned an unreadable response");
    if (input && !Array.isArray(parsed.data)) {
      return { ...parsed.data, environment: parsed.data.environment === "dev" ? "development" : parsed.data.environment === "prod" ? "production" : "staging" };
    }
    return parsed.data;
  }

  async ensure(user: RequestUser, input: EnsureInput, key: string | undefined, correlationId: string) {
    if (key !== user.clerkId) throw new ValidationError("Idempotency-Key must match authenticated subject");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ active_workspace_id: string | null }>(
        "SELECT active_workspace_id FROM provisr_identity.users WHERE id=$1 FOR UPDATE", [user.userId]);
      let workspaceId = input.workspaceId || current.rows[0]?.active_workspace_id || null;
      if (workspaceId) {
        const membership = await client.query(`SELECT 1 FROM provisr_identity.memberships m
          JOIN provisr_identity.workspaces w ON w.id=m.workspace_id
          WHERE m.user_id=$1 AND m.workspace_id=$2 AND w.deleted_at IS NULL FOR SHARE OF m,w`, [user.userId, workspaceId]);
        if (!membership.rows[0]) {
          if (input.workspaceId) throw new ForbiddenError("Workspace membership required");
          workspaceId = null;
        }
      }
      await client.query(`UPDATE provisr_identity.users SET name=COALESCE($2,name),email=COALESCE($3,email),
        avatar_url=COALESCE($4,avatar_url),active_workspace_id=$5,updated_at=now() WHERE id=$1`,
      [user.userId, input.name ?? null, input.email ?? null, input.avatarUrl ?? null, workspaceId]);
      const auditWorkspaceId = workspaceId ?? current.rows[0]?.active_workspace_id;
      if (auditWorkspaceId && workspaceId !== current.rows[0]?.active_workspace_id) {
        await this.audit.append({ workspaceId: auditWorkspaceId, eventType: "state_transition", actorId: user.userId, actorType: "user",
          resourceType: "user", resourceId: user.userId, payload: { action: "active_workspace_selected", workspace_id: workspaceId }, correlationId }, client);
      }
      await client.query("COMMIT");
      return { id: user.userId, workspaceId };
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
}
