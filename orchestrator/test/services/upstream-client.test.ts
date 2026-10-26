import { describe, expect, it, vi } from "vitest";
import { UpstreamClient } from "../../src/services/upstream-client";
import { DependencyError, UpstreamError } from "../../src/common/errors/typed-errors";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

function rawResponse(status: number, raw: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => raw } as unknown as Response;
}

describe("UpstreamClient", () => {
  it("builds the URL with defined, non-empty query parameters", async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { accounts: [] }));
    const client = new UpstreamClient("http://svc:8089/", fetcher as unknown as typeof fetch);

    await client.request("/v1/cloud-accounts", {
      method: "GET",
      query: { workspace_id: "ws-1", role: undefined, empty: "" },
    });

    const [url, init] = fetcher.mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(parsed.origin).toBe("http://svc:8089");
    expect(parsed.pathname).toBe("/v1/cloud-accounts");
    expect(parsed.searchParams.get("workspace_id")).toBe("ws-1");
    expect(parsed.searchParams.has("role")).toBe(false);
    expect(parsed.searchParams.has("empty")).toBe(false);
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("serializes the body and sets Content-Type on mutations", async () => {
    const fetcher = vi.fn(async () => jsonResponse(201, { id: "acct-1" }));
    const client = new UpstreamClient("http://svc:8089", fetcher as unknown as typeof fetch);

    await client.request("/v1/cloud-accounts", { method: "POST", body: { provider: "aws" } });

    const [, init] = fetcher.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect((init as RequestInit).body).toBe(JSON.stringify({ provider: "aws" }));
  });

  it("forwards custom headers and drops undefined values", async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, {}));
    const client = new UpstreamClient("http://svc:8088", fetcher as unknown as typeof fetch);

    await client.request("/permissions/check", {
      method: "POST",
      body: {},
      headers: { Authorization: "Bearer token", "X-Skip": undefined },
    });

    const [, init] = fetcher.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer token");
    expect(headers["X-Skip"]).toBeUndefined();
  });

  it("returns the status and parsed body on success", async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { allowed: true }));
    const client = new UpstreamClient("http://svc:8088", fetcher as unknown as typeof fetch);

    const result = await client.request("/permissions/check", { method: "POST", body: {} });
    expect(result).toEqual({ status: 200, body: { allowed: true } });
  });

  it("returns an undefined body for a 204 response", async () => {
    const fetcher = vi.fn(async () => jsonResponse(204, undefined));
    const client = new UpstreamClient("http://svc:8088", fetcher as unknown as typeof fetch);

    const result = await client.request("/workspaces/ws-1/members/u-1", { method: "DELETE" });
    expect(result).toEqual({ status: 204, body: undefined });
  });

  it("preserves the upstream status and domain slug on non-2xx responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse(410, { error: "revoked", message: "invitation has been revoked", status: 410 }));
    const client = new UpstreamClient("http://svc:8088", fetcher as unknown as typeof fetch);

    try {
      await client.request("/invitations", { method: "GET", query: { code: "abc" } });
      throw new Error("expected UpstreamError");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamError);
      const upstream = error as UpstreamError;
      expect(upstream.status).toBe(410);
      expect(upstream.code).toBe("revoked");
      expect(upstream.message).toBe("invitation has been revoked");
    }
  });

  it("still reports the upstream status when the error body is not JSON", async () => {
    const fetcher = vi.fn(async () => rawResponse(500, "<html>boom</html>"));
    const client = new UpstreamClient("http://svc:8088", fetcher as unknown as typeof fetch);

    await expect(client.request("/x", { method: "GET" })).rejects.toMatchObject({
      status: 500,
      code: "upstream_error",
    });
  });

  it("maps a network failure to a dependency error", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new UpstreamClient("http://svc:8088", fetcher as unknown as typeof fetch);

    await expect(client.request("/x", { method: "GET" })).rejects.toBeInstanceOf(DependencyError);
  });

  it("maps an unreadable success body to a dependency error", async () => {
    const fetcher = vi.fn(async () => rawResponse(200, "not json"));
    const client = new UpstreamClient("http://svc:8088", fetcher as unknown as typeof fetch);

    await expect(client.request("/x", { method: "GET" })).rejects.toBeInstanceOf(DependencyError);
  });
});
