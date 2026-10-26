import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudAccountsClient } from "../../src/services/cloud-accounts.client";
import type { UpstreamClient } from "../../src/services/upstream-client";
import { DependencyError, UpstreamError } from "../../src/common/errors/typed-errors";
import { gatewayCtx } from "../helpers/gateway-mocks";

describe("CloudAccountsClient", () => {
  let request: ReturnType<typeof vi.fn>;
  let client: CloudAccountsClient;

  beforeEach(() => {
    request = vi.fn(async () => ({ status: 200, body: { accounts: [] } }));
    client = new CloudAccountsClient({ request } as unknown as UpstreamClient, "svc-token");
  });

  const ctx = () => gatewayCtx({ idempotencyKey: "idem-1" });

  it("scopes list by the injected workspace and forwards request ids", async () => {
    await client.list("ws-1", ctx());

    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/v1/cloud-accounts");
    expect(options.method).toBe("GET");
    expect(options.query).toEqual({ workspace_id: "ws-1" });
    expect(options.headers["X-Request-ID"]).toBe("req-1");
    expect(options.headers["X-Correlation-ID"]).toBe("corr-1");
    expect(options.headers["Authorization"]).toBeUndefined();
  });

  it("gets a single account scoped by workspace", async () => {
    await client.get("ws-1", "acct-1", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/v1/cloud-accounts/acct-1");
    expect(options.query).toEqual({ workspace_id: "ws-1" });
  });

  it("creates an account with the injected workspace id and idempotency key", async () => {
    await client.create("ws-1", { provider: "aws", label: "Prod", metadata: { role_arn: "arn" } }, ctx());

    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/v1/cloud-accounts");
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({ provider: "aws", label: "Prod", metadata: { role_arn: "arn" }, workspace_id: "ws-1" });
    expect(options.headers["Idempotency-Key"]).toBe("idem-1");
  });

  it("does not send an idempotency header when the caller omitted the key", async () => {
    await client.remove("ws-1", "acct-1", gatewayCtx());
    const [, options] = request.mock.calls[0]!;
    expect(options.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("removes an account with workspace scoping", async () => {
    await client.remove("ws-1", "acct-1", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/v1/cloud-accounts/acct-1");
    expect(options.method).toBe("DELETE");
    expect(options.query).toEqual({ workspace_id: "ws-1" });
  });

  it("verifies an account with the external id", async () => {
    await client.verify("ws-1", "acct-1", "ext-123", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/v1/cloud-accounts/acct-1/verify");
    expect(options.body).toEqual({ external_id: "ext-123" });
    expect(options.query).toEqual({ workspace_id: "ws-1" });
  });

  it("presents the service token on the capabilities endpoint", async () => {
    await client.capabilities("ws-1", ctx());
    const [path, options] = request.mock.calls[0]!;
    expect(path).toBe("/v1/workspaces/ws-1/cloud-capabilities");
    expect(options.headers["Authorization"]).toBe("Bearer svc-token");
  });

  it("maps a capabilities 401 to a dependency error so the session is not treated as signed out", async () => {
    request.mockRejectedValueOnce(new UpstreamError(401, "unauthorized", "unauthorized"));
    await expect(client.capabilities("ws-1", ctx())).rejects.toBeInstanceOf(DependencyError);
  });

  it("passes other capabilities upstream errors through unchanged", async () => {
    request.mockRejectedValueOnce(new UpstreamError(400, "invalid_workspace", "bad workspace"));
    await expect(client.capabilities("ws-1", ctx())).rejects.toBeInstanceOf(UpstreamError);
  });
});
