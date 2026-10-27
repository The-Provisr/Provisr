import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authProtect: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.authProtect },
}));

import { proxyInvitation, proxyWorkspace } from "./server";

describe("team BFF proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ORCHESTRATION_API_URL", "http://orch");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("scopes workspace calls to the session claim and forwards the idempotency key", async () => {
    mocks.authProtect.mockResolvedValue({
      getToken: async () => "tok",
      sessionClaims: { metadata: { workspaceId: "ws-1" } },
    });
    const req = new Request("http://app/api/team/members/u1", {
      method: "PATCH",
      headers: { "Idempotency-Key": "k1" },
      body: JSON.stringify({ role: "viewer" }),
    });

    const res = await proxyWorkspace(req, "/members/u1", { method: "PATCH", withBody: true });

    expect(res.status).toBe(204);
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://orch/v1/workspaces/ws-1/members/u1");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", "Idempotency-Key": "k1" });
  });

  it("returns 409 when the session has no workspace", async () => {
    mocks.authProtect.mockResolvedValue({ getToken: async () => "tok", sessionClaims: {} });
    const res = await proxyWorkspace(new Request("http://app/api/team/members"), "/members");
    expect(res.status).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("allows invitation calls without a workspace claim and passes errors through", async () => {
    mocks.authProtect.mockResolvedValue({ getToken: async () => "tok", sessionClaims: {} });
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "email_mismatch", message: "m" }), { status: 403 }),
    );
    const req = new Request("http://app/api/invitations/accept?code=abc", {
      method: "POST",
      headers: { "Idempotency-Key": "k2" },
      body: JSON.stringify({ name: "Bo" }),
    });

    const res = await proxyInvitation(req, "/v1/invitations/accept", { method: "POST", withBody: true });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "email_mismatch" });
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe("http://orch/v1/invitations/accept?code=abc");
  });

  it("rejects invitation calls without a code", async () => {
    mocks.authProtect.mockResolvedValue({ getToken: async () => "tok", sessionClaims: {} });
    const res = await proxyInvitation(new Request("http://app/api/invitations"), "/v1/invitations");
    expect(res.status).toBe(400);
  });
});
