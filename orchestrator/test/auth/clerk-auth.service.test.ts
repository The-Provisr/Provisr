import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { ClerkAuthService } from "../../src/auth/clerk-auth.service";
import type { MembershipClient } from "../../src/auth/clerk-auth.service";
import type { AuthConfig } from "../../src/auth/auth.config";

const config = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  secretKey: "sk_test_fake",
  authorizedParties: undefined,
  tokenCacheTtlMs: 60_000,
  membershipCacheTtlMs: 60_000,
  ...overrides,
});

const VALID_CLAIMS = {
  sub: "clerk_user_1",
  sid: "sess_1",
  email: "user@provisr.io",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function fakeVerify(claims?: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async () => claims ?? VALID_CLAIMS);
}

function fakeClient(overrides: Partial<MembershipClient> = {}): MembershipClient {
  return {
    users: {
      getOrganizationMembershipList: vi.fn(async () => ({
        data: [
          { organization: { id: "org_1" }, role: "org:admin" },
          { organization: { id: "org_2" }, role: "org:member" },
        ],
        totalCount: 2,
      })),
    },
    ...overrides,
  };
}

describe("ClerkAuthService.verifyToken", () => {
  it("returns extracted claims for a valid token", async () => {
    const verify = fakeVerify();
    const service = new ClerkAuthService(config(), verify, fakeClient());

    const claims = await service.verifyToken("jwt.token.here");

    expect(claims).toEqual({
      sub: "clerk_user_1",
      sid: "sess_1",
      email: "user@provisr.io",
      exp: expect.any(Number),
      orgId: undefined,
      orgRole: undefined,
    });
  });

  it("caches verified tokens and does not re-verify within the TTL", async () => {
    const verify = fakeVerify();
    const service = new ClerkAuthService(config(), verify, fakeClient());

    await service.verifyToken("jwt.token.here");
    await service.verifyToken("jwt.token.here");

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("re-verifies after the cache TTL expires", async () => {
    const verify = fakeVerify();
    const service = new ClerkAuthService(config({ tokenCacheTtlMs: 10 }), verify, fakeClient());

    await service.verifyToken("jwt.token.here");
    await new Promise((resolve) => setTimeout(resolve, 25));
    await service.verifyToken("jwt.token.here");

    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("returns null when verification throws (never the reason)", async () => {
    const verify = vi.fn(async () => {
      throw new Error("JWT expired");
    });
    const service = new ClerkAuthService(config(), verify, fakeClient());

    expect(await service.verifyToken("bad.token")).toBeNull();
  });

  it("includes the correlation id when logging a verification failure", async () => {
    const verify = vi.fn(async () => {
      throw new Error("JWT expired");
    });
    const service = new ClerkAuthService(config(), verify, fakeClient());
    const debug = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    await service.verifyToken("bad.token", "trace-abc-123");

    expect(debug).toHaveBeenCalledWith(
      { correlationId: "trace-abc-123", err: "Error: JWT expired" },
      "Token verification failed",
    );
    debug.mockRestore();
  });

  it("returns null when verification yields no claims", async () => {
    const verify = vi.fn(async () => undefined);
    const service = new ClerkAuthService(config(), verify, fakeClient());

    expect(await service.verifyToken("bad.token")).toBeNull();
  });

  it("returns null without a secret key", async () => {
    const verify = vi.fn();
    const service = new ClerkAuthService(config({ secretKey: undefined }), verify, fakeClient());

    expect(await service.verifyToken("jwt.token.here")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("passes authorized parties to the verifier when configured", async () => {
    const verify = fakeVerify();
    const service = new ClerkAuthService(
      config({ authorizedParties: ["http://localhost:3000"] }),
      verify,
      fakeClient(),
    );

    await service.verifyToken("jwt.token.here");

    expect(verify).toHaveBeenCalledWith("jwt.token.here", {
      secretKey: "sk_test_fake",
      authorizedParties: ["http://localhost:3000"],
    });
  });

  it("survives claims without an email or sid", async () => {
    const verify = fakeVerify({ sub: "clerk_user_2", exp: Math.floor(Date.now() / 1000) + 3600 });
    const service = new ClerkAuthService(config(), verify, fakeClient());

    const claims = await service.verifyToken("jwt.token.here");

    expect(claims?.sub).toBe("clerk_user_2");
    expect(claims?.email).toBeUndefined();
    expect(claims?.sid).toBeUndefined();
  });
});

describe("ClerkAuthService.getOrganizationMemberships", () => {
  it("maps Clerk organizations to workspace memberships", async () => {
    const client = fakeClient();
    const service = new ClerkAuthService(config(), fakeVerify(), client);

    const memberships = await service.getOrganizationMemberships("clerk_user_1");

    expect(memberships).toEqual([
      { workspaceId: "org_1", role: "org:admin" },
      { workspaceId: "org_2", role: "org:member" },
    ]);
  });

  it("caches memberships within the TTL", async () => {
    const client = fakeClient();
    const service = new ClerkAuthService(config(), fakeVerify(), client);

    await service.getOrganizationMemberships("clerk_user_1");
    await service.getOrganizationMemberships("clerk_user_1");

    expect(client.users.getOrganizationMembershipList).toHaveBeenCalledTimes(1);
  });

  it("paginates until totalCount is reached", async () => {
    const pages = [
      { data: [{ organization: { id: "org_1" }, role: "org:admin" }], totalCount: 3 },
      { data: [{ organization: { id: "org_2" }, role: "org:member" }], totalCount: 3 },
      { data: [{ organization: { id: "org_3" }, role: "org:admin" }], totalCount: 3 },
    ];
    const list = vi.fn(async (params: { limit?: number; offset?: number }) => pages[params.offset ?? 0]);
    const client = fakeClient({ users: { getOrganizationMembershipList: list } });
    const service = new ClerkAuthService(config(), fakeVerify(), client);

    const memberships = await service.getOrganizationMemberships("clerk_user_1");

    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenNthCalledWith(1, { userId: "clerk_user_1", limit: 100, offset: 0 });
    expect(list).toHaveBeenNthCalledWith(2, { userId: "clerk_user_1", limit: 100, offset: 1 });
    expect(list).toHaveBeenNthCalledWith(3, { userId: "clerk_user_1", limit: 100, offset: 2 });
    expect(memberships).toEqual([
      { workspaceId: "org_1", role: "org:admin" },
      { workspaceId: "org_2", role: "org:member" },
      { workspaceId: "org_3", role: "org:admin" },
    ]);
  });

  it("throws a typed DependencyError when the Clerk API call fails", async () => {
    const client = fakeClient({
      users: {
        getOrganizationMembershipList: vi.fn(async () => {
          throw new Error("rate limited");
        }),
      },
    });
    const service = new ClerkAuthService(config(), fakeVerify(), client);

    await expect(service.getOrganizationMemberships("clerk_user_1")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 502,
      message: "Clerk membership service unavailable",
    });
  });

  it("includes the correlation id when logging a membership failure", async () => {
    const client = fakeClient({
      users: {
        getOrganizationMembershipList: vi.fn(async () => {
          throw new Error("rate limited");
        }),
      },
    });
    const service = new ClerkAuthService(config(), fakeVerify(), client);
    const debug = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    await expect(
      service.getOrganizationMemberships("clerk_user_1", "trace-abc-123"),
    ).rejects.toThrow();

    expect(debug).toHaveBeenCalledWith(
      { correlationId: "trace-abc-123", userId: "clerk_user_1", err: "Error: rate limited" },
      "Membership resolution failed",
    );
    debug.mockRestore();
  });

  it("returns [] without a secret key", async () => {
    const service = new ClerkAuthService(config({ secretKey: undefined }), fakeVerify());

    expect(await service.getOrganizationMemberships("clerk_user_1")).toEqual([]);
  });
});
