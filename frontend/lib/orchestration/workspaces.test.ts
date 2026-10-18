import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createWorkspace, WorkspaceCreateError } from "./workspaces";

const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createWorkspace", () => {
  beforeEach(() => {
    process.env.ORCHESTRATION_API_URL = "http://orchestrator.test";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts the create payload with auth and idempotency headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { id: "ws_1", name: "Acme", slug: "acme-1a2b3c4d", environment: "development" },
        201,
      ),
    );
    global.fetch = fetchMock;

    const result = await createWorkspace(
      "token-123",
      { name: "Acme", description: "Team home", environment: "development" },
      "idem-1",
    );

    expect(result.id).toBe("ws_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://orchestrator.test/v1/workspaces");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
    expect(headers["Idempotency-Key"]).toBe("idem-1");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Acme",
      description: "Team home",
      environment: "development",
    });
  });

  it("maps a 409 to a slug_taken WorkspaceCreateError", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: "slug_taken", message: 'slug "acme" is already taken', status: 409 }, 409),
    );

    await expect(
      createWorkspace("t", { name: "Acme", environment: "development" }, "idem"),
    ).rejects.toMatchObject({ code: "slug_taken", status: 409 });
  });

  it("maps a 400 to a validation_error", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "name must be between 3 and 64 characters" }, 400));

    const error = await createWorkspace(
      "t",
      { name: "Acme", environment: "development" },
      "idem",
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(WorkspaceCreateError);
    expect(error).toMatchObject({ code: "validation_error", status: 400 });
  });

  it("maps a 501 (OR-004 not wired) to workspace_create_failed", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: "NOT_IMPLEMENTED", message: "not implemented" }, 501));

    await expect(
      createWorkspace("t", { name: "Acme", environment: "development" }, "idem"),
    ).rejects.toMatchObject({ code: "workspace_create_failed", status: 501 });
  });

  it("maps a timeout to workspace_create_failed", async () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    global.fetch = vi.fn().mockRejectedValue(timeoutError);

    await expect(
      createWorkspace("t", { name: "Acme", environment: "development" }, "idem"),
    ).rejects.toMatchObject({ code: "workspace_create_failed", status: 504 });
  });
});
