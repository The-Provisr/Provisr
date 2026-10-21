import { describe, expect, it, vi } from "vitest";
import type { ClerkAuthService } from "../../src/auth/clerk-auth.service";
import { IdentityService } from "../../src/auth/identity.service";
import type { DbService } from "../../src/db/db.service";

const claims = {
  sub: "clerk_user_1",
  sid: "sess_1",
  email: "user@provisr.io",
  exp: Math.floor(Date.now() / 1000) + 3600,
  orgId: "clerk_org_not_a_workspace",
  orgRole: "org:admin",
};
const storedUser = {
  id: "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a",
  clerk_id: claims.sub,
  email: claims.email,
  created_at: new Date("2026-10-01T00:00:00.000Z"),
};

function serviceWith(query: ReturnType<typeof vi.fn>) {
  return new IdentityService({ query } as unknown as DbService);
}

describe("IdentityService", () => {
  it("returns the persisted user id and creation time", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [storedUser] });

    const user = await serviceWith(query).getOrCreateUser(claims);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (clerk_id)"), [claims.sub, claims.email]);
    expect(user).toEqual({
      userId: storedUser.id,
      clerkId: claims.sub,
      email: claims.email,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("keeps the same database identity across service instances and returning sessions", async () => {
    let persisted: typeof storedUser | undefined;
    const query = vi.fn().mockImplementation(async (_sql: string, values: unknown[]) => {
      persisted ??= { ...storedUser, clerk_id: values[0] as string, email: values[1] as string };
      return { rows: [persisted] };
    });

    const first = await serviceWith(query).getOrCreateUser(claims);
    const returning = await serviceWith(query).getOrCreateUser({ ...claims, sid: "new_session" });

    expect(returning).toEqual(first);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("supports a verified identity without an email", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ...storedUser, email: "" }] });
    const user = await serviceWith(query).getOrCreateUser({ ...claims, email: undefined });
    expect(query).toHaveBeenCalledWith(expect.any(String), [claims.sub, ""]);
    expect(user.email).toBeUndefined();
  });

  it("uses only Clerk-verified primary email, not stale database or session values", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [storedUser] });
    const getVerifiedEmail = vi.fn().mockResolvedValue("verified@example.invalid");
    const identity = new IdentityService({ query } as unknown as DbService, { getVerifiedEmail } as unknown as ClerkAuthService);
    expect((await identity.getOrCreateUser(claims)).email).toBe("verified@example.invalid");
    expect(query).toHaveBeenCalledWith(expect.any(String), [claims.sub, "verified@example.invalid"]);
    getVerifiedEmail.mockResolvedValue(undefined);
    expect((await identity.getOrCreateUser(claims)).email).toBeUndefined();
  });

  it("resolves live Provisr memberships instead of Clerk organization claims", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { workspace_id: "workspace_1", role: "viewer" },
      { workspace_id: "workspace_2", role: "engineer" },
    ] });

    const memberships = await serviceWith(query).resolveMemberships(claims.sub);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("provisr_identity.memberships"), [claims.sub]);
    expect(query.mock.calls[0]![0]).toContain("w.deleted_at IS NULL");
    expect(memberships).toEqual([
      { workspaceId: "workspace_1", role: "viewer" },
      { workspaceId: "workspace_2", role: "engineer" },
    ]);
  });

  it("returns no memberships when database contains none", async () => {
    expect(await serviceWith(vi.fn().mockResolvedValue({ rows: [] })).resolveMemberships(claims.sub)).toEqual([]);
  });

  it("fails rather than inventing an identity or membership during a database outage", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const identity = serviceWith(query);
    await expect(identity.getOrCreateUser(claims)).rejects.toThrow("database unavailable");
    await expect(identity.resolveMemberships(claims.sub)).rejects.toThrow("database unavailable");
  });
});
