import { afterEach, describe, expect, it, vi } from "vitest";
import { orchestrationBaseUrl } from "./base-url";

describe("orchestrationBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the configured public URL", () => {
    vi.stubEnv("NEXT_PUBLIC_ORCHESTRATION_API_URL", "http://orchestrator.test");
    expect(orchestrationBaseUrl()).toBe("http://orchestrator.test");
  });

  it("falls back to localhost in development", () => {
    vi.stubEnv("NEXT_PUBLIC_ORCHESTRATION_API_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(orchestrationBaseUrl()).toBe("http://localhost:4000");
  });

  it("throws when unconfigured outside development", () => {
    vi.stubEnv("NEXT_PUBLIC_ORCHESTRATION_API_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(() => orchestrationBaseUrl()).toThrow(
      /NEXT_PUBLIC_ORCHESTRATION_API_URL/,
    );
  });
});
