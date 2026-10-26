import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationsController } from "../../src/routes/invitations.controller";
import type { WorkspaceServiceClient } from "../../src/services/workspace-service.client";
import type { WorkspaceAccessService } from "../../src/services/workspace-access.service";
import { ForbiddenError } from "../../src/common/errors/typed-errors";
import { ALLOW_NO_WORKSPACE_MEMBERSHIP_KEY } from "../../src/middleware/allow-no-workspace.decorator";
import { mockRequest, mockResponse, requestUser } from "../helpers/gateway-mocks";

const WS = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const INV = "33333333-3333-4333-8333-333333333333";

function setup() {
  const workspace = {
    createInvitation: vi.fn(async () => ({ status: 201, body: { id: INV } })),
    listInvitations: vi.fn(async () => ({ status: 200, body: [] })),
    getInvitation: vi.fn(async () => ({ status: 200, body: { id: INV } })),
    revokeInvitation: vi.fn(async () => ({ status: 204, body: undefined })),
    getInvitationByCode: vi.fn(async () => ({ status: 200, body: { id: INV } })),
    acceptInvitation: vi.fn(async () => ({ status: 200, body: { id: "u-1" } })),
  };
  const access = { assertAllowed: vi.fn(async () => undefined) };
  const controller = new InvitationsController(
    workspace as unknown as WorkspaceServiceClient,
    access as unknown as WorkspaceAccessService,
  );
  return { workspace, access, controller };
}

describe("InvitationsController", () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
  });
  const user = requestUser();

  it("requires invitation.create and forwards the idempotency key", async () => {
    const res = mockResponse();
    await h.controller.create(WS, { email: "a@b.io", role: "viewer" }, user, mockRequest(), res, "idem-1");
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "invitation", "create", expect.anything());
    const [, input, ctx] = h.workspace.createInvitation.mock.calls[0]!;
    expect(input).toEqual({ email: "a@b.io", role: "viewer" });
    expect(ctx.idempotencyKey).toBe("idem-1");
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("requires invitation.list and invitation.view", async () => {
    await h.controller.list(WS, user, mockRequest(), mockResponse());
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "invitation", "list", expect.anything());

    await h.controller.get(WS, INV, user, mockRequest(), mockResponse());
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "invitation", "view", expect.anything());
  });

  it("requires invitation.revoke and returns 204", async () => {
    const res = mockResponse();
    await h.controller.revoke(WS, INV, user, mockRequest(), res, undefined);
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "invitation", "revoke", expect.anything());
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("allows invited users (no workspace membership) to look up a code", async () => {
    const res = mockResponse();
    await h.controller.lookupByCode("code-1", user, mockRequest(), res);
    expect(h.workspace.getInvitationByCode).toHaveBeenCalledWith("code-1", expect.anything());
    expect(h.access.assertAllowed).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("injects the authenticated user id and email when accepting", async () => {
    const res = mockResponse();
    await h.controller.accept("code-1", { name: "Ada" }, user, mockRequest(), res, "idem-1");
    const [, input, ctx] = h.workspace.acceptInvitation.mock.calls[0]!;
    expect(input).toEqual({ user_id: user.userId, name: "Ada", email: user.email });
    expect(ctx.idempotencyKey).toBe("idem-1");
    expect(h.access.assertAllowed).not.toHaveBeenCalled();
  });

  it("rejects accept when the authenticated user has no email", async () => {
    await expect(
      h.controller.accept("code-1", { name: "Ada" }, requestUser({ email: undefined }), mockRequest(), mockResponse(), undefined),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.workspace.acceptInvitation).not.toHaveBeenCalled();
  });

  it("marks the invitee endpoints as reachable without workspace membership", () => {
    const lookup = Reflect.getMetadata(
      ALLOW_NO_WORKSPACE_MEMBERSHIP_KEY,
      InvitationsController.prototype.lookupByCode,
    );
    const accept = Reflect.getMetadata(
      ALLOW_NO_WORKSPACE_MEMBERSHIP_KEY,
      InvitationsController.prototype.accept,
    );
    expect(lookup).toBe(true);
    expect(accept).toBe(true);
  });
});
