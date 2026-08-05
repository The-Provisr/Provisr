import { afterEach, describe, expect, it } from "vitest";
import { loadAuthConfig } from "../../src/auth/auth.config";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("loadAuthConfig", () => {
  it("reads CLERK_SECRET_KEY and defaults the caches", () => {
    process.env.CLERK_SECRET_KEY = "sk_test_abc";

    const config = loadAuthConfig();

    expect(config.secretKey).toBe("sk_test_abc");
    expect(config.authorizedParties).toBeUndefined();
    expect(config.tokenCacheTtlMs).toBe(60_000);
    expect(config.membershipCacheTtlMs).toBe(60_000);
  });

  it("parses authorized parties and custom TTLs", () => {
    process.env.CLERK_SECRET_KEY = "sk_test_abc";
    process.env.CLERK_AUTHORIZED_PARTIES = " http://localhost:3000 , https://app.provisr.io ,";
    process.env.CLERK_TOKEN_CACHE_TTL_MS = "5000";
    process.env.CLERK_MEMBERSHIP_CACHE_TTL_MS = "7000";

    const config = loadAuthConfig();

    expect(config.authorizedParties).toEqual([
      "http://localhost:3000",
      "https://app.provisr.io",
    ]);
    expect(config.tokenCacheTtlMs).toBe(5000);
    expect(config.membershipCacheTtlMs).toBe(7000);
  });

  it("falls back to defaults for invalid TTLs", () => {
    process.env.CLERK_TOKEN_CACHE_TTL_MS = "not-a-number";

    expect(loadAuthConfig().tokenCacheTtlMs).toBe(60_000);
  });

  it("falls back to defaults for partially numeric TTLs", () => {
    process.env.CLERK_TOKEN_CACHE_TTL_MS = "5000ms";
    process.env.CLERK_MEMBERSHIP_CACHE_TTL_MS = "60 seconds";

    const config = loadAuthConfig();

    expect(config.tokenCacheTtlMs).toBe(60_000);
    expect(config.membershipCacheTtlMs).toBe(60_000);
  });

  it("fails fast in production without CLERK_SECRET_KEY", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CLERK_SECRET_KEY;

    expect(() => loadAuthConfig()).toThrow(/CLERK_SECRET_KEY is required/);
  });

  it("allows a missing key outside production", () => {
    delete process.env.CLERK_SECRET_KEY;
    expect(loadAuthConfig().secretKey).toBeUndefined();
  });
});
