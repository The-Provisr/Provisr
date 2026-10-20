import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudAccountsController,
  CloudCapabilitiesController,
} from "../../src/routes/cloud-accounts.controller";
import type { CloudAccountsClient } from "../../src/services/cloud-accounts.client";
import type { WorkspaceAccessService } from "../../src/services/workspace-access.service";
import {
  NotFoundError,
  NotImplementedError,
  ValidationError,
} from "../../src/common/errors/typed-errors";
import { mockRequest, mockResponse, requestUser } from "../helpers/gateway-mocks";

const WS = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ACCT = "11111111-1111-4111-8111-111111111111";

function setup() {
  const cloud = {
    list: vi.fn(async () => ({ status: 200, body: { accounts: [] } })),
    get: vi.fn(async () => ({ status: 200, body: { id: ACCT } })),
    create: vi.fn(async () => ({ status: 201, body: { id: ACCT, status: "pending" } })),
    remove: vi.fn(async () => ({ status: 204, body: undefined })),
    verify: vi.fn(async () => ({ status: 200, body: { status: "active" } })),
    capabilities: vi.fn(async () => ({ status: 200, body: { accounts: [] } })),
  };
  const access = { assertAllowed: vi.fn(async () => undefined) };
  const controller = new CloudAccountsController(
    cloud as unknown as CloudAccountsClient,
    access as unknown as WorkspaceAccessService,
  );
  const capabilities = new CloudCapabilitiesController(
    cloud as unknown as CloudAccountsClient,
    access as unknown as WorkspaceAccessService,
  );
  return { cloud, access, controller, capabilities };
}

describe("CloudAccountsController", () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
  });

  const user = requestUser();

  it("authorizes view and forwards the list result with its status", async () => {
    const res = mockResponse();
    await h.controller.list(WS, user, mockRequest(), res);

    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "cloud_account", "view", expect.anything());
    expect(h.cloud.list).toHaveBeenCalledWith(WS, expect.anything());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ accounts: [] });
  });

  it("passes the idempotency header through on create and excludes it from the body", async () => {
    const res = mockResponse();
    await h.controller.create(
      WS,
      { provider: "aws", label: "Prod", metadata: { role_arn: "arn:aws:iam::1:role/x" } },
      user,
      mockRequest(),
      res,
      "idem-7",
    );

    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "cloud_account", "create", expect.anything());
    const [, input, ctx] = h.cloud.create.mock.calls[0]!;
    expect(input).toEqual({ provider: "aws", label: "Prod", metadata: { role_arn: "arn:aws:iam::1:role/x" } });
    expect(input).not.toHaveProperty("workspace_id");
    expect(ctx.idempotencyKey).toBe("idem-7");
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("sends a 204 through with an empty body on delete", async () => {
    const res = mockResponse();
    await h.controller.remove(WS, ACCT, user, mockRequest(), res, undefined);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("verifies a UUID account id directly", async () => {
    const res = mockResponse();
    await h.controller.verify(WS, ACCT, { external_id: "ext" }, user, mockRequest(), res, undefined);
    expect(h.cloud.verify).toHaveBeenCalledWith(WS, ACCT, "ext", expect.anything());
  });

  it("rejects a non-UUID, non-provider verify segment", async () => {
    await expect(
      h.controller.verify(WS, "not-a-uuid", { external_id: "ext" }, user, mockRequest(), mockResponse(), undefined),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(h.cloud.verify).not.toHaveBeenCalled();
  });

  it("resolves the workspace AWS account for the /aws/verify form", async () => {
    h.cloud.list.mockResolvedValueOnce({ status: 200, body: { accounts: [{ id: ACCT, provider: "aws" }] } });
    const res = mockResponse();
    await h.controller.verify(WS, "aws", { external_id: "ext" }, user, mockRequest(), res, undefined);
    expect(h.cloud.verify).toHaveBeenCalledWith(WS, ACCT, "ext", expect.anything());
  });

  it("returns 404 when the workspace has no AWS account", async () => {
    h.cloud.list.mockResolvedValueOnce({ status: 200, body: { accounts: [] } });
    await expect(
      h.controller.verify(WS, "aws", { external_id: "ext" }, user, mockRequest(), mockResponse(), undefined),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns 501 for provider verification that the backend does not support yet", async () => {
    await expect(
      h.controller.verify(WS, "gcp", { external_id: "ext" }, user, mockRequest(), mockResponse(), undefined),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("authorizes before returning the not-implemented template placeholder", async () => {
    await expect(
      h.controller.template(WS, ACCT, user, mockRequest(), mockResponse()),
    ).rejects.toBeInstanceOf(NotImplementedError);
    expect(h.access.assertAllowed).toHaveBeenCalledWith(user.userId, WS, "cloud_account", "view", expect.anything());
  });
});

describe("CloudCapabilitiesController", () => {
  it("authorizes view and forwards capabilities", async () => {
    const h = setup();
    const res = mockResponse();
    await h.capabilities.get(WS, requestUser(), mockRequest(), res);
    expect(h.access.assertAllowed).toHaveBeenCalledWith("user-1", WS, "cloud_account", "view", expect.anything());
    expect(h.cloud.capabilities).toHaveBeenCalledWith(WS, expect.anything());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
