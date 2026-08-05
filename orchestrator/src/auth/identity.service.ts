import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ClerkAuthService, ClerkSessionClaims } from "./clerk-auth.service";
import type { WorkspaceMembership } from "./clerk-auth.service";

/** Internal Provisr user record created from a verified Clerk identity. */
export interface ProvisionedUser {
  /** Internal Provisr user id (UUID). */
  userId: string;
  /** Clerk user id this record maps to. */
  clerkId: string;
  email: string | undefined;
  createdAt: string;
}

interface WorkspaceContext {
  workspaceId: string;
  role: string;
}

/**
 * Maps verified Clerk identities to internal Provisr user records and
 * resolves workspace memberships. Records are created on-the-fly when a
 * Clerk user appears for the first time, and are reused afterwards.
 *
 * Storage is an in-memory repository keyed by Clerk user id; it is a
 * stand-in until the workspace/user data layer (BE-A03/BE-A04) exposes a
 * real store, at which point only this class changes.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly usersByClerkId = new Map<string, ProvisionedUser>();

  constructor(private readonly clerk: ClerkAuthService) {}

  /** Returns the internal user for a Clerk identity, creating it if new. */
  async getOrCreateUser(claims: ClerkSessionClaims): Promise<ProvisionedUser> {
    const existing = this.usersByClerkId.get(claims.sub);
    if (existing) {
      return existing;
    }

    const user: ProvisionedUser = {
      userId: randomUUID(),
      clerkId: claims.sub,
      email: claims.email,
      createdAt: new Date().toISOString(),
    };
    this.usersByClerkId.set(user.clerkId, user);
    this.logger.debug(`Provisioned Provisr user ${user.userId} for Clerk user ${user.clerkId}`);
    return user;
  }

  /**
   * Resolves the workspaces (Clerk organizations) a user belongs to with
   * their role in each. Returns [] when the user has no memberships.
   */
  async resolveMemberships(clerkId: string, correlationId?: string): Promise<WorkspaceContext[]> {
    const memberships = await this.clerk.getOrganizationMemberships(clerkId, correlationId);
    return memberships.map((membership: WorkspaceMembership) => ({
      workspaceId: membership.workspaceId,
      role: membership.role,
    }));
  }
}
