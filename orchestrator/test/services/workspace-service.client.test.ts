import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceServiceClient } from "../../src/services/workspace-service.client";
import type { UpstreamClient } from "../../src/services/upstream-client";
import { gatewayCtx } from "../helpers/gateway-mocks";

describe("WorkspaceServiceClient", () => {
  let request: ReturnType<typeof vi.fn>;
  let client: WorkspaceServiceClient;

  beforeEach(() => {
    request = vi.fn(async () => ({ status: 200, body: {} }));
    client = new WorkspaceServiceClient({ request } as unknown as UpstreamClient);
  });

  const ctx = () => gatewayCtx({ idempotencyKey: "idem-1" });

  it("lists members and forwards the role filter", async () => {
    await client.listMembers("ws-1", "admin", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/workspaces/ws-1/members");
    expect(options.method).toBe("GET");
    expect(options.query).toEqual({ role: "admin" });
    expect(options.headers["X-Request-ID"]).toBe("req-1");
  });

  it("adds a member with the idempotency key", async () => {
    await client.addMember("ws-1", { user_id: "u-1", role: "engineer" }, ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/workspaces/ws-1/members");
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({ user_id: "u-1", role: "engineer" });
    expect(options.headers["Idempotency-Key"]).toBe("idem-1");
  });

  it("updates a member role by path and body", async () => {
    await client.updateMemberRole("ws-1", "u-1", { role: "approver" }, ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/workspaces/ws-1/members/u-1");
    expect(options.method).toBe("PATCH");
    expect(options.body).toEqual({ role: "approver" });
  });

  it("removes a member with the idempotency key", async () => {
    await client.removeMember("ws-1", "u-1", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/workspaces/ws-1/members/u-1");
    expect(options.method).toBe("DELETE");
    expect(options.headers["Idempotency-Key"]).toBe("idem-1");
  });

  it("creates an invitation with the idempotency key", async () => {
    await client.createInvitation("ws-1", { email: "a@b.io", role: "viewer" }, ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/workspaces/ws-1/invitations");
    expect(options.body).toEqual({ email: "a@b.io", role: "viewer" });
    expect(options.headers["Idempotency-Key"]).toBe("idem-1");
  });

  it("revokes an invitation", async () => {
    await client.revokeInvitation("ws-1", "inv-1", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/workspaces/ws-1/invitations/inv-1/revoke");
    expect(options.method).toBe("POST");
  });

  it("looks up an invitation by code with no idempotency header", async () => {
    await client.getInvitationByCode("code-1", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/invitations");
    expect(options.query).toEqual({ code: "code-1" });
    expect(options.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("accepts an invitation with the injected identity and code", async () => {
    await client.acceptInvitation("code-1", { user_id: "u-1", name: "Ada", email: "ada@x.io" }, ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/invitations/accept");
    expect(options.query).toEqual({ code: "code-1" });
    expect(options.body).toEqual({ user_id: "u-1", name: "Ada", email: "ada@x.io" });
    expect(options.headers["Idempotency-Key"]).toBe("idem-1");
  });

  it("checks a single permission", async () => {
    await client.checkPermission(
      { user_id: "u-1", workspace_id: "ws-1", resource_type: "member", action: "add" },
      gatewayCtx(),
    );
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/permissions/check");
    expect(options.body).toEqual({ user_id: "u-1", workspace_id: "ws-1", resource_type: "member", action: "add" });
  });

  it("checks a batch of permissions", async () => {
    await client.checkBatch(
      [{ user_id: "u-1", workspace_id: "ws-1", resource_type: "member", action: "add" }],
      gatewayCtx(),
    );
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/permissions/check-batch");
    expect(options.body).toEqual({
      checks: [{ user_id: "u-1", workspace_id: "ws-1", resource_type: "member", action: "add" }],
    });
  });
});
