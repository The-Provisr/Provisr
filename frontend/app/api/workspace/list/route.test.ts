import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authProtect: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.authProtect },
}));

vi.mock("@/lib/orchestration/workspaces", () => ({
  listWorkspaces: mocks.listWorkspaces,
}));

import { GET } from "./route";

describe("GET /api/workspace/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authProtect.mockResolvedValue({
      userId: "user_1",
      getToken: async () => "token-abc",
      sessionClaims: { metadata: { workspaceId: "ws_1" } },
    });
    mocks.listWorkspaces.mockResolvedValue([
      {
        id: "ws_1",
        name: "Acme Platform",
        slug: "acme-platform",
        environment: "production",
        role: "admin",
      },
    ]);
  });

  it("returns the memberships and the active workspace id", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workspaces: [
        {
          id: "ws_1",
          name: "Acme Platform",
          slug: "acme-platform",
          environment: "production",
          role: "admin",
        },
      ],
      activeWorkspaceId: "ws_1",
      degraded: false,
    });
    expect(mocks.listWorkspaces).toHaveBeenCalledWith("token-abc");
  });

  it("degrades to an empty list when the orchestrator (OR-004 stub) errors", async () => {
    mocks.listWorkspaces.mockRejectedValue(new Error("listWorkspaces failed: 501"));

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workspaces: [],
      activeWorkspaceId: "ws_1",
      degraded: true,
    });
  });

  it("clears a claimed workspace absent from authenticated memberships", async () => {
    mocks.listWorkspaces.mockResolvedValue([]);
    const res = await GET();
    await expect(res.json()).resolves.toMatchObject({ activeWorkspaceId: null, degraded: false });
  });

  it("degrades when no token can be minted", async () => {
    mocks.authProtect.mockResolvedValue({
      userId: "user_1",
      getToken: async () => null,
      sessionClaims: { metadata: {} },
    });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workspaces: [],
      activeWorkspaceId: null,
      degraded: true,
    });
    expect(mocks.listWorkspaces).not.toHaveBeenCalled();
  });
});
