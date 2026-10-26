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

  it.each([undefined, null, "", " ", 42])("rejects verified claims without a valid subject: %j", async (sub) => {
    vi.mocked(verifyToken).mockResolvedValue({ sub } as never);
    const request = makeRequest({ name: UNIQUE(), environment: "development" });
    expect((await POST(request)).status).toBe(401);
    expect((await GET(new Request(request.url, { headers: request.headers }))).status).toBe(401);
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
    expect(second.status).toBe(201);
    expect(secondRecord).toEqual(firstRecord);
    expect(Object.keys(secondRecord).sort()).toEqual([
      "created_at", "description", "environment", "id", "name", "slug", "updated_at",
    ]);
  });

  it.each([
    { field: "name", value: UNIQUE() },
    { field: "environment", value: "production" },
    { field: "description", value: "Different description" },
  ])("rejects a changed $field for the same subject and idempotency key", async ({ field, value }) => {
    const key = UNIQUE();
    const payload = { name: UNIQUE(), environment: "development", description: "Team home" };
    await POST(makeRequest(payload, { "Idempotency-Key": key }));
    const res = await POST(makeRequest({ ...payload, [field]: value }, { "Idempotency-Key": key }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "duplicate_idempotency_key", message: "Idempotency-Key was already used for another request", status: 409,
    });
  });

  it("scopes replay keys to the verified subject without exposing another user's workspace", async () => {
    const key = UNIQUE();
    const first = await POST(makeRequest({ name: UNIQUE(), environment: "development" }, { "Idempotency-Key": key }));
    const firstRecord = await first.json();

    vi.mocked(verifyToken).mockResolvedValue({ sub: "other_replay_user" } as never);
    const foreignReplay = await POST(makeRequest(
      { name: firstRecord.name, environment: "development" },
      { "Idempotency-Key": key },
    ));
    expect(foreignReplay.status).toBe(409);
    await expect(foreignReplay.json()).resolves.toMatchObject({ error: "slug_taken" });

    const otherPayload = { name: UNIQUE(), environment: "staging" };
    const other = await POST(makeRequest(otherPayload, { "Idempotency-Key": key }));
    const otherRecord = await other.json();
    expect(other.status).toBe(201);
    expect(otherRecord.id).not.toBe(firstRecord.id);
    expect(otherRecord).toMatchObject(otherPayload);

    const replay = await POST(makeRequest(otherPayload, { "Idempotency-Key": key }));
    await expect(replay.json()).resolves.toEqual(otherRecord);
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

  it("lists only the verified caller's workspaces without internal ownership or replay fields", async () => {
    const firstUser = UNIQUE();
    const secondUser = UNIQUE();
    vi.mocked(verifyToken).mockResolvedValue({ sub: firstUser } as never);
    const owned = await (await POST(makeRequest({ name: UNIQUE(), environment: "development" }))).json();

    vi.mocked(verifyToken).mockResolvedValue({ sub: secondUser } as never);
    const other = await (await POST(makeRequest({ name: UNIQUE(), environment: "staging" }))).json();
    const secondList = await (await GET(getRequest())).json();
    expect(secondList).toEqual([{ ...other, role: "admin" }]);

    vi.mocked(verifyToken).mockResolvedValue({ sub: firstUser } as never);
    const firstList = await (await GET(getRequest())).json();
    expect(firstList).toEqual([{ ...owned, role: "admin" }]);
    expect(Object.keys(firstList[0]).sort()).toEqual([
      "created_at", "description", "environment", "id", "name", "role", "slug", "updated_at",
    ]);
  });
});
