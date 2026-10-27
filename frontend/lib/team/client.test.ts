import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  errorMessage,
  hasErrorCode,
  isForbidden,
  listMembers,
  lookupInvitation,
  removeMember,
  revokeInvitation,
} from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Init = { method?: string; body: string; headers: Record<string, string> };

describe("team client", () => {
  const fetchMock = vi.fn();
  const call = (index: number) => fetchMock.mock.calls[index] as [string, Init];

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists members through the BFF", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: "u1", email: "a@x.dev", role: "admin" }]));
    await expect(listMembers()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/team/members", expect.anything());
  });

  it("sends role changes as PATCH with an idempotency key", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await changeMemberRole("user 1", "viewer");
    const [url, init] = call(0);
    expect(url).toBe("/api/team/members/user%201");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ role: "viewer" });
    expect(init.headers["Idempotency-Key"]).toEqual(expect.any(String));
  });

  it("surfaces the last-admin guard with its code and friendly copy", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: "last_admin", message: "cannot change role of the last admin" }, 409),
    );
    const error = await changeMemberRole("u1", "viewer").catch((e: unknown) => e);
    expect(hasErrorCode(error, "last_admin")).toBe(true);
    expect(errorMessage(error)).toMatch(/at least one admin/);
  });

  it("surfaces the active-runs block on remove", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: "active_runs_exist", message: "x" }, 409));
    const error = await removeMember("u1").catch((e: unknown) => e);
    expect(hasErrorCode(error, "active_runs_exist")).toBe(true);
    expect(errorMessage(error)).toMatch(/active provisioning runs/);
    expect(call(0)[1].method).toBe("DELETE");
  });

  it("creates and revokes invitations", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "inv1", code: "c1" }, 201));
    await createInvitation("b@x.dev", "engineer");
    expect(call(0)[0]).toBe("/api/team/invitations");
    expect(JSON.parse(call(0)[1].body)).toEqual({ email: "b@x.dev", role: "engineer" });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await revokeInvitation("inv1");
    expect(call(1)[0]).toBe("/api/team/invitations/inv1/revoke");
    expect(call(1)[1].method).toBe("POST");
  });

  it("looks up and accepts by code", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "inv1" }));
    await lookupInvitation("a b");
    expect(call(0)[0]).toBe("/api/invitations?code=a%20b");

    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "email_mismatch", message: "m" }, 403));
    const error = await acceptInvitation("abc", "Bo").catch((e: unknown) => e);
    expect(call(1)[0]).toBe("/api/invitations/accept?code=abc");
    expect(JSON.parse(call(1)[1].body)).toEqual({ name: "Bo" });
    expect(hasErrorCode(error, "email_mismatch")).toBe(true);
    expect(isForbidden(error)).toBe(false);
  });

  it("treats gateway 403s as forbidden", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: "FORBIDDEN", message: "nope" }, 403));
    const error = await listMembers().catch((e: unknown) => e);
    expect(isForbidden(error)).toBe(true);
  });
});
