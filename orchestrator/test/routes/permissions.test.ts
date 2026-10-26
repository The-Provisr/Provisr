import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsController } from "../../src/routes/permissions.controller";
import type { WorkspaceServiceClient } from "../../src/services/workspace-service.client";
import { mockRequest, mockResponse, requestUser } from "../helpers/gateway-mocks";

const WS = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function setup() {
  const workspace = {
    checkPermission: vi.fn(async () => ({ status: 200, body: { allowed: true, reason: "" } })),
    checkBatch: vi.fn(async () => ({ status: 200, body: { results: [] } })),
  };
  const controller = new PermissionsController(workspace as unknown as WorkspaceServiceClient);
  return { workspace, controller };
}

describe("PermissionsController", () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
  });
  const user = requestUser();

  it("injects the authenticated user id into a single check", async () => {
    const res = mockResponse();
    await h.controller.check({ workspace_id: WS, resource_type: "member", action: "add" }, user, mockRequest(), res);

    const [input] = h.workspace.checkPermission.mock.calls[0]!;
    expect(input).toEqual({ workspace_id: WS, resource_type: "member", action: "add", user_id: user.userId });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("injects the authenticated user id into every batch check", async () => {
    await h.controller.checkBatch(
      {
        checks: [
          { workspace_id: WS, resource_type: "member", action: "add" },
          { workspace_id: WS, resource_type: "cloud_account", action: "view" },
        ],
      },
      user,
      mockRequest(),
      mockResponse(),
    );

    const [checks] = h.workspace.checkBatch.mock.calls[0]!;
    expect(checks).toEqual([
      { workspace_id: WS, resource_type: "member", action: "add", user_id: user.userId },
      { workspace_id: WS, resource_type: "cloud_account", action: "view", user_id: user.userId },
    ]);
  });
});
