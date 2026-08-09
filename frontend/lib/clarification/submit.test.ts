import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK_TOKEN = "mock-token";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ORCHESTRATION_API_URL", "http://localhost:4000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("submitClarification", () => {
  it("posts answers to /v1/runs/:id/clarify with idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { submitClarification } = await import("@/lib/clarification/submit");

    await submitClarification(
      "run-123",
      "q-1",
      { answers: { region: "us-east-1" } },
      MOCK_TOKEN,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/v1/runs/run-123/clarify");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"answers":{"region":"us-east-1"}}');
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer mock-token",
      "Idempotency-Key": "clarify:run-123:q-1",
    });
  });

  it("throws on non-ok response (501 until OR-010 lands)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 501,
      text: () => Promise.resolve("Not implemented"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { submitClarification } = await import("@/lib/clarification/submit");

    await expect(
      submitClarification(
        "run-123",
        "q-1",
        { answers: { region: "us-east-1" } },
        MOCK_TOKEN,
      ),
    ).rejects.toThrow("submitClarification failed: 501 Not implemented");
  });

  it("throws a configuration error when NEXT_PUBLIC_ORCHESTRATION_API_URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORCHESTRATION_API_URL", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const { submitClarification } = await import("@/lib/clarification/submit");

    await expect(
      submitClarification(
        "run-123",
        "q-1",
        { answers: { region: "us-east-1" } },
        MOCK_TOKEN,
      ),
    ).rejects.toThrow(
      "NEXT_PUBLIC_ORCHESTRATION_API_URL must be configured for client execution",
    );
  });
});
