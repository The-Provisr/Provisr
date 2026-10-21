import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authProtect: vi.fn(),
  currentUser: vi.fn(),
  reconcileWorkspaceMetadata: vi.fn(),
  ensureUser: vi.fn(),
  createWorkspace: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.authProtect },
  currentUser: mocks.currentUser,
}));

vi.mock("@/lib/orchestration/metadata", () => ({
  reconcileWorkspaceMetadata: mocks.reconcileWorkspaceMetadata,
}));

vi.mock("@/lib/orchestration/users", () => ({
  ensureUser: mocks.ensureUser,
}));

vi.mock("@/lib/orchestration/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orchestration/workspaces")>();
  return { ...actual, createWorkspace: mocks.createWorkspace };
});

import { POST } from "./route";
import { WorkspaceCreateError } from "@/lib/orchestration/workspaces";

const validUser = {
  id: "user_1",
  firstName: "Ada",
  lastName: "Lovelace",
  imageUrl: "https://img.test/ada.png",
  primaryEmailAddress: { emailAddress: "ada@example.com" },
};

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/workspace/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const validBody = { name: "Acme Platform", environment: "development" };

describe("POST /api/workspace/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authProtect.mockResolvedValue({
      userId: "user_1",
      getToken: async () => "token-abc",
      sessionClaims: { metadata: {} },
    });
    mocks.currentUser.mockResolvedValue(validUser);
    mocks.createWorkspace.mockResolvedValue({
      id: "ws_1",
      name: "Acme Platform",
      slug: "acme-platform-1a2b3c4d",
      environment: "development",
    });
    mocks.ensureUser.mockResolvedValue({ id: "user_1", workspaceId: "ws_1" });
    mocks.reconcileWorkspaceMetadata.mockResolvedValue(undefined);
  });

  it("returns 401 when there is no current user", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range name", async () => {
    const res = await POST(makeRequest({ name: "ab", environment: "development" }));
    expect(res.status).toBe(400);
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown environment", async () => {
    const res = await POST(makeRequest({ name: "Acme Platform", environment: "dev" }));
    expect(res.status).toBe(400);
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("returns 409 and slug_taken when the orchestrator reports a conflict", async () => {
    mocks.createWorkspace.mockRejectedValue(
      new WorkspaceCreateError(409, "slug_taken", 'slug "acme-platform" is already taken'),
    );

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "slug_taken" });
  });

  it("creates the workspace, links the user, reconciles metadata and returns 201", async () => {
    const res = await POST(
      makeRequest({ ...validBody, description: " Team home ", providers: ["aws", "azure", "bogus"] }, {
        "Idempotency-Key": "idem-1",
      }),
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      workspaceId: "ws_1",
      slug: "acme-platform-1a2b3c4d",
      environment: "development",
    });

    const [, createInput, idem] = mocks.createWorkspace.mock.calls[0]!;
    expect(createInput).toEqual({
      name: "Acme Platform",
      description: "Team home",
      environment: "development",
      providers: ["aws", "azure"],
    });
    expect(idem).toBe("idem-1");

    expect(mocks.ensureUser).toHaveBeenCalledWith(
      "token-abc",
      expect.objectContaining({ workspaceId: "ws_1", email: "ada@example.com" }),
      "user_1",
    );
    expect(mocks.reconcileWorkspaceMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        backendWorkspaceId: "ws_1",
        providers: ["aws", "azure"],
      }),
    );
  });

  it.each([null, "ws_other"])("fails closed when user links to %s", async (workspaceId) => {
    mocks.ensureUser.mockResolvedValue({ id: "user_1", workspaceId });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "workspace_create_failed" });
    expect(mocks.reconcileWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it("fails closed when ensureUser fails", async () => {
    mocks.ensureUser.mockRejectedValue(new Error("users/ensure down"));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "workspace_create_failed" });
    expect(mocks.reconcileWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it.each([undefined, "", " ", "x".repeat(129)])("requires a bounded client idempotency key: %j", async (key) => {
    const req = makeRequest(validBody);
    if (key === undefined) req.headers.delete("Idempotency-Key");
    else req.headers.set("Idempotency-Key", key);

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
    expect(mocks.ensureUser).not.toHaveBeenCalled();
    expect(mocks.reconcileWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it("returns a safe failure when metadata persistence fails and permits retry with the same key", async () => {
    mocks.reconcileWorkspaceMetadata.mockRejectedValueOnce(new Error("Clerk secret details"));

    const failed = await POST(makeRequest(validBody));

    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: "workspace_create_failed" });

    const retried = await POST(makeRequest(validBody));

    expect(retried.status).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.createWorkspace.mock.calls.map((call) => call[2])).toEqual(["idem-test", "idem-test"]);
  });

  it("maps upstream 501 (OR-004 not wired) to a 501 pass-through", async () => {
    mocks.createWorkspace.mockRejectedValue(
      new WorkspaceCreateError(501, "workspace_create_failed", "not implemented"),
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(501);
  });
});
