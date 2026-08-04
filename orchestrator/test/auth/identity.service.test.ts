import { describe, expect, it, vi } from "vitest";
import { IdentityService } from "../../src/auth/identity.service";
import { ClerkAuthService } from "../../src/auth/clerk-auth.service";
import type { AuthConfig } from "../../src/auth/auth.config";

const config: AuthConfig = {
  secretKey: "sk_test_fake",
  authorizedParties: undefined,
  tokenCacheTtlMs: 60_000,
  membershipCacheTtlMs: 60_000,
};

const claims = {
  sub: "clerk_user_1",
  sid: "sess_1",
  email: "user@provisr.io",
  exp: Math.floor(Date.now() / 1000) + 3600,
  orgId: undefined,
  orgRole: undefined,
};

function serviceWith(memberships: { workspaceId: string; role: string }[]): {
  identity: IdentityService;
  clerk: ClerkAuthService;
} {
  const clerk = new ClerkAuthService(config, undefined, {
    users: {
      getOrganizationMembershipList: vi.fn(async () => ({
        data: memberships.map((membership) => ({
          organization: { id: membership.workspaceId },
          role: membership.role,
        })),
      })),
    },
  });
  return { identity: new IdentityService(clerk), clerk };
}

describe("IdentityService", () => {
  it("creates an internal user record on first sight of a Clerk identity", async () => {
    const { identity } = serviceWith([]);

    const user = await identity.getOrCreateUser(claims);

    expect(user.clerkId).toBe("clerk_user_1");
    expect(user.email).toBe("user@provisr.io");
    expect(user.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(user.createdAt).toBeTruthy();
  });

  it("reuses the existing record for a returning Clerk identity", async () => {
    const { identity } = serviceWith([]);

    const first = await identity.getOrCreateUser(claims);
    const second = await identity.getOrCreateUser(claims);

    expect(second.userId).toBe(first.userId);
  });

  it("resolves workspace memberships with roles", async () => {
    const { identity } = serviceWith([
      { workspaceId: "org_1", role: "org:admin" },
      { workspaceId: "org_2", role: "org:member" },
    ]);

    const memberships = await identity.resolveMemberships("clerk_user_1");

    expect(memberships).toEqual([
      { workspaceId: "org_1", role: "org:admin" },
      { workspaceId: "org_2", role: "org:member" },
    ]);
  });

  it("returns [] for a user with no memberships", async () => {
    const { identity } = serviceWith([]);

    expect(await identity.resolveMemberships("clerk_user_1")).toEqual([]);
  });
});
