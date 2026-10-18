import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  verifyToken: vi.fn().mockResolvedValue({ sub: "user_1" }),
}));

import { verifyToken } from "@clerk/nextjs/server";
import { GET, POST } from "./route";

const UNIQUE = () => `Test ${Math.random().toString(36).slice(2, 10)}`;

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/dev/orchestration/v1/workspaces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
      "Idempotency-Key": `idem-${Math.random().toString(36).slice(2)}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("dev orchestration POST /v1/workspaces", () => {
  beforeEach(() => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: "user_1" } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(makeRequest({ name: UNIQUE(), environment: "development" }));
    expect(res.status).toBe(404);
  });

  it("rejects a request without a bearer token", async () => {
    const res = await POST(
      makeRequest({ name: UNIQUE(), environment: "development" }, { Authorization: "" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a token that fails verification", async () => {
    vi.mocked(verifyToken).mockRejectedValueOnce(new Error("bad token") as never);
    const res = await POST(makeRequest({ name: UNIQUE(), environment: "development" }));
    expect(res.status).toBe(401);
  });

  it("requires an Idempotency-Key", async () => {
    const res = await POST(
      makeRequest({ name: UNIQUE(), environment: "development" }, { "Idempotency-Key": "" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a workspace with a suffixed slug", async () => {
    const name = UNIQUE();
    const res = await POST(makeRequest({ name, environment: "staging", description: "hi" }));

    expect(res.status).toBe(201);
    const record = await res.json();
    expect(record).toMatchObject({ name, environment: "staging", description: "hi" });
    expect(record.slug).toMatch(/^test-|^test\d/);
    expect(typeof record.id).toBe("string");
  });

  it("replays the same workspace for a repeated idempotency key", async () => {
    const name = UNIQUE();
    const key = "replay-key-1";

    const first = await POST(
      makeRequest({ name, environment: "development" }, { "Idempotency-Key": key }),
    );
    const second = await POST(
      makeRequest({ name, environment: "development" }, { "Idempotency-Key": key }),
    );

    const firstRecord = await first.json();
    const secondRecord = await second.json();
    expect(secondRecord.id).toBe(firstRecord.id);
  });

  it("returns 409 when a workspace with the same base slug already exists", async () => {
    const name = UNIQUE();
    await POST(makeRequest({ name, environment: "development" }));

    const res = await POST(makeRequest({ name, environment: "development" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "slug_taken" });
  });

  it("returns 400 for an unknown environment", async () => {
    const res = await POST(makeRequest({ name: UNIQUE(), environment: "dev" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/dev/orchestration/v1/workspaces", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Idempotency-Key": "bad-body",
        },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("dev orchestration GET /v1/workspaces", () => {
  function getRequest(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/dev/orchestration/v1/workspaces", {
      method: "GET",
      headers: { Authorization: "Bearer test-token", ...headers },
    });
  }

  beforeEach(() => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: "user_1" } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await GET(getRequest());
    expect(res.status).toBe(404);
  });

  it("rejects a request without a bearer token", async () => {
    const res = await GET(getRequest({ Authorization: "" }));
    expect(res.status).toBe(401);
  });

  it("returns the created workspaces as admin memberships", async () => {
    const name = UNIQUE();
    const created = await POST(makeRequest({ name, environment: "development" }));
    const record = await created.json();

    const res = await GET(getRequest());
    expect(res.status).toBe(200);

    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContainEqual(
      expect.objectContaining({ id: record.id, name, slug: record.slug, role: "admin" }),
    );
  });
});
