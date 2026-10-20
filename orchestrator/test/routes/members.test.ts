import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembersController } from "../../src/routes/members.controller";
import type { WorkspaceServiceClient } from "../../src/services/workspace-service.client";
import type { WorkspaceAccessService } from "../../src/services/workspace-access.service";
import { mockRequest, mockResponse, requestUser } from "../helpers/gateway-mocks";

const WS = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const U1 = "22222222-2222-4222-8222-222222222222";

function setup() {
  const workspace = {
    listMembers: vi.fn(async () => ({ status: 200, body: [] })),
    addMember: vi.fn(async () => ({ status: 201, body: { id: U1 } })),
    updateMemberRole: vi.fn(async () => ({ status: 204, body: undefined })),
    removeMember: vi.fn(async () => ({ status: 204, body: undefined })),
  };
  const access = { assertAllowed: vi.fn(async () => undefined) };
  const controller = new MembersController(
    workspace as unknown as WorkspaceServiceClient,
    access as unknown as WorkspaceAccessService,
  );
  return { workspace, access, controller };
}

describe("MembersController", () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
  });
  const user = requestUser();

  it("requires member.list and forwards the role filter", async () => {
    const res = mockResponse();
    await h.controller.list(WS, "admin", user, mockRequest(), res);
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "member", "list", expect.anything());
    expect(h.workspace.listMembers).toHaveBeenCalledWith(WS, "admin", expect.anything());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("requires member.add and forwards the idempotency key", async () => {
    const res = mockResponse();
    await h.controller.add(WS, { user_id: U1, role: "engineer" }, user, mockRequest(), res, "idem-1");
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "member", "add", expect.anything());
    const [, input, ctx] = h.workspace.addMember.mock.calls[0]!;
    expect(input).toEqual({ user_id: U1, role: "engineer" });
    expect(ctx.idempotencyKey).toBe("idem-1");
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("requires member.update_role on role change", async () => {
    await h.controller.updateRole(WS, U1, { role: "approver" }, user, mockRequest(), mockResponse(), undefined);
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "member", "update_role", expect.anything());
    expect(h.workspace.updateMemberRole).toHaveBeenCalledWith(WS, U1, { role: "approver" }, expect.anything());
  });

  it("requires member.remove and returns 204", async () => {
    const res = mockResponse();
    await h.controller.remove(WS, U1, user, mockRequest(), res, undefined);
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "member", "remove", expect.anything());
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});
