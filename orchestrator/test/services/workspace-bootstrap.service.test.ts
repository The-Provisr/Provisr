import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { WorkspaceBootstrapService } from "../../src/services/workspace-bootstrap.service";
import type { DbService } from "../../src/db/db.service";
import type { AuditService } from "../../src/services/audit.service";
import type { RequestUser } from "../../src/middleware/auth.types";

const workspaceId = "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a";
const oldWorkspaceId = "c1c2c3c4-2c4a-4d6e-8f0a-1b2c3d4e5f6a";
const user: RequestUser = {
  userId: "9b88f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a",
  clerkId: "clerk_user_1", email: "member@test.dev", workspaceIds: [], roles: {},
};
const workspace = { id: workspaceId, name: "Acme", slug: "acme", environment: "dev" };
const originalFetch = global.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(options: { current?: string | null; membership?: boolean } = {}) {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT active_workspace_id")) return { rows: [{ active_workspace_id: options.current ?? null }] };
    if (sql.includes("SELECT 1 FROM provisr_identity.memberships")) return { rows: options.membership === false ? [] : [{ present: 1 }] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const connect = vi.fn().mockResolvedValue(client);
  const append = vi.fn().mockResolvedValue(undefined);
  const service = new WorkspaceBootstrapService(
    { connect } as unknown as DbService,
    { append } as unknown as AuditService,
    "http://workspace.test",
  );
  return { service, query, client, connect, append };
}

describe("WorkspaceBootstrapService", () => {
  beforeEach(() => { global.fetch = vi.fn().mockResolvedValue(json(workspace, 201)); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  describe("workspaces", () => {
    it.each([
      ["development", "dev"], ["staging", "staging"], ["production", "prod"],
    ] as const)("maps %s and uses the authenticated creator", async (environment, expected) => {
      global.fetch = vi.fn().mockResolvedValue(json({ ...workspace, environment: expected }, 201));
      const { service } = setup();
      const input = { name: "Acme", environment, description: "Team", creator_id: "forged_user" };
      const result = await service.workspaces(user, input, "create-key");
      expect(global.fetch).toHaveBeenCalledWith("http://workspace.test/workspaces", expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "create-key" },
        body: JSON.stringify({ name: "Acme", environment: expected, description: "Team", creator_id: user.userId }),
      }));
      expect(result).toMatchObject({ id: workspaceId, environment });
    });

    it("lists only the authenticated user's workspaces with backend membership roles", async () => {
      global.fetch = vi.fn().mockResolvedValue(json([{ ...workspace, role: "viewer" }]));
      const { service } = setup();
      expect(await service.workspaces(user)).toEqual([{ ...workspace, role: "viewer" }]);
      expect(global.fetch).toHaveBeenCalledWith(`http://workspace.test/workspaces?user_id=${user.userId}`, expect.objectContaining({ method: "GET" }));
    });

    it.each([undefined, "", " ", "x".repeat(129)])("rejects an absent or unbounded mutation key: %j", async (key) => {
      const { service } = setup();
      await expect(service.workspaces(user, { name: "Acme", environment: "development" }, key)).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it.each(["slug_taken", "duplicate_idempotency_key"])("preserves upstream %s conflict codes", async (code) => {
      global.fetch = vi.fn().mockResolvedValue(json({ error: code, message: "Conflict" }, 409));
      const error = await setup().service.workspaces(user, { name: "Acme", environment: "development" }, "key").catch((err: unknown) => err);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toEqual({ message: "Conflict", code });
    });

    it.each([
      json({ ...workspace, id: "not-a-uuid" }, 201),
      json({ ...workspace, environment: "invalid" }, 201),
      new Response("bad json", { status: 201 }),
      json({ error: "internal", message: "database credentials" }, 500),
      json({ message: "untyped conflict" }, 409),
    ])("fails safely for malformed or unavailable upstream responses", async (response) => {
      global.fetch = vi.fn().mockResolvedValue(response);
      await expect(setup().service.workspaces(user, { name: "Acme", environment: "development" }, "key")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 502 });
    });

    it("rejects lists with malformed membership roles", async () => {
      global.fetch = vi.fn().mockResolvedValue(json([{ ...workspace, role: "org:admin" }]));
      await expect(setup().service.workspaces(user)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 502 });
    });

    it("maps network failures to a safe dependency error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("internal network address"));
      await expect(setup().service.workspaces(user)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 502, message: "Workspace service unavailable" });
    });
  });

  describe("ensure", () => {
    it("selects the exact requested workspace only after live membership verification", async () => {
      const { service, query, client, append } = setup({ current: oldWorkspaceId });
      expect(await service.ensure(user, { workspaceId, name: "Ada" }, user.clerkId, "trace-1")).toEqual({ id: user.userId, workspaceId });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("m.user_id=$1 AND m.workspace_id=$2"), [user.userId, workspaceId]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE provisr_identity.users"), [user.userId, "Ada", user.email, null, workspaceId]);
      expect(append).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId, actorId: user.userId, correlationId: "trace-1",
        payload: { action: "active_workspace_selected", workspace_id: workspaceId },
      }), client);
      expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
      expect(client.release).toHaveBeenCalledOnce();
    });

    it("ignores a caller-supplied email and retains the authenticated identity email", async () => {
      const { service, query } = setup();
      await service.ensure(user, { email: "victim@example.invalid" }, user.clerkId, "trace-1");
      expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE provisr_identity.users"),
        [user.userId, null, user.email, null, null]);
    });

    it("keeps a verified current selection without duplicating transition audit", async () => {
      const { service, query, append } = setup({ current: workspaceId });
      expect(await service.ensure(user, {}, user.clerkId, "trace-1")).toEqual({ id: user.userId, workspaceId });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("m.user_id=$1 AND m.workspace_id=$2"), [user.userId, workspaceId]);
      expect(append).not.toHaveBeenCalled();
    });

    it("does not duplicate audit when retrying the same explicit workspace selection", async () => {
      const { service, append } = setup({ current: workspaceId });
      expect(await service.ensure(user, { workspaceId }, user.clerkId, "retry-trace")).toEqual({ id: user.userId, workspaceId });
      expect(append).not.toHaveBeenCalled();
    });

    it("does not pick an arbitrary membership for a user with no active selection", async () => {
      const { service, query, append } = setup();
      expect(await service.ensure(user, {}, user.clerkId, "trace-1")).toEqual({ id: user.userId, workspaceId: null });
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining("SELECT 1 FROM provisr_identity.memberships"), expect.anything());
      expect(append).not.toHaveBeenCalled();
    });

    it("rolls back foreign workspace selection without writing user or audit", async () => {
      const { service, query, client, append } = setup({ current: oldWorkspaceId, membership: false });
      await expect(service.ensure(user, { workspaceId }, user.clerkId, "trace-1")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE provisr_identity.users"), expect.anything());
      expect(append).not.toHaveBeenCalled();
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(client.release).toHaveBeenCalledOnce();
    });

    it("clears a stale current workspace when membership was revoked", async () => {
      const { service, query, client, append } = setup({ current: oldWorkspaceId, membership: false });
      expect(await service.ensure(user, {}, user.clerkId, "trace-1")).toEqual({ id: user.userId, workspaceId: null });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE provisr_identity.users"), [user.userId, null, user.email, null, null]);
      expect(append).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: oldWorkspaceId, actorId: user.userId,
        payload: { action: "active_workspace_selected", workspace_id: null },
      }), client);
    });

    it("rolls back workspace selection when transition audit fails", async () => {
      const { service, query, client, append } = setup();
      append.mockRejectedValue(new Error("audit unavailable"));
      await expect(service.ensure(user, { workspaceId }, user.clerkId, "trace-1")).rejects.toThrow("audit unavailable");
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(query).not.toHaveBeenCalledWith("COMMIT");
      expect(client.release).toHaveBeenCalledOnce();
    });

    it.each([undefined, "other_clerk_user", ""])("requires the authenticated subject as idempotency key: %j", async (key) => {
      const { service, connect, append } = setup();
      await expect(service.ensure(user, { workspaceId }, key, "trace-1")).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
      expect(connect).not.toHaveBeenCalled();
      expect(append).not.toHaveBeenCalled();
    });
  });
});
