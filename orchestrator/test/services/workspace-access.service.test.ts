import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessService } from "../../src/services/workspace-access.service";
import type { WorkspaceServiceClient } from "../../src/services/workspace-service.client";
import { DependencyError, ForbiddenError } from "../../src/common/errors/typed-errors";
import { gatewayCtx } from "../helpers/gateway-mocks";

function service(checkResult: unknown): WorkspaceAccessService {
  const checkPermission = vi.fn(async () => ({ status: 200, body: checkResult }));
  return new WorkspaceAccessService({ checkPermission } as unknown as WorkspaceServiceClient);
}

describe("WorkspaceAccessService", () => {
  it("resolves without error when the permission is allowed", async () => {
    const access = service({ allowed: true, reason: "" });
    await expect(access.assertAllowed("u-1", "ws-1", "cloud_account", "view", gatewayCtx())).resolves.toBeUndefined();
  });

  it("throws a 403 carrying the upstream reason when denied", async () => {
    const access = service({ allowed: false, reason: "role viewer does not permit action add" });
    try {
      await access.assertAllowed("u-1", "ws-1", "member", "add", gatewayCtx());
      throw new Error("expected ForbiddenError");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).message).toBe("role viewer does not permit action add");
      expect((error as ForbiddenError).status).toBe(403);
    }
  });

  it("falls back to the generic 403 message when no reason is supplied", async () => {
    const access = service({ allowed: false });
    try {
      await access.assertAllowed("u-1", "ws-1", "member", "add", gatewayCtx());
      throw new Error("expected ForbiddenError");
    } catch (error) {
      expect((error as ForbiddenError).message).toBe("You do not have permission to perform this action");
    }
  });

  it("fails closed with a 502 when the response is unreadable", async () => {
    const access = service({ not: "a permission result" });
    await expect(
      access.assertAllowed("u-1", "ws-1", "member", "add", gatewayCtx()),
    ).rejects.toBeInstanceOf(DependencyError);
  });
});
