import { createClerkClient, verifyToken } from "@clerk/backend";
import { Injectable, Logger } from "@nestjs/common";
import type { AuthConfig } from "./auth.config";
import { DependencyError } from "../common/errors/typed-errors";

/** Claims extracted from a verified Clerk session JWT. */
export interface ClerkSessionClaims {
  /** Clerk user id (sub claim). */
  sub: string;
  /** Clerk session id (sid claim). */
  sid: string | undefined;
  /** Email claim; present only when the Clerk JWT template includes it. */
  email: string | undefined;
  /** Expiry timestamp (seconds). */
  exp: number;
  /** Active organization id (org_id claim), when the user has an active org. */
  orgId: string | undefined;
  /** Role inside the active organization (org_role claim). */
  orgRole: string | undefined;
}

export interface WorkspaceMembership {
  /** Clerk organization id, used as the Provisr workspace id. */
  workspaceId: string;
  /** Role inside the workspace, e.g. "org:admin" or "org:member". */
  role: string;
}

/** Test seam: shape of the token-verification function we depend on. */
type VerifyTokenFn = (
  token: string,
  options: { secretKey?: string | undefined; authorizedParties?: string[] | undefined },
) => Promise<Record<string, unknown> | undefined>;

/** Narrow view of the Clerk client surface this service needs. */
export interface MembershipClient {
  users: {
    getOrganizationMembershipList(params: {
      userId: string;
    }): Promise<{ data: { organization: { id: string }; role: string }[] }>;
  };
}

/**
 * Thin gateway over the Clerk backend SDK. Owns token verification against
 * the (internally cached) Clerk JWKS endpoint and organization membership
 * resolution. Verification failures return null so the caller can answer
 * with one generic 401 and never reveal *why* a token was rejected; Clerk
 * membership failures throw a typed DependencyError (502) so an outage is
 * never misreported as an empty membership list.
 */
@Injectable()
export class ClerkAuthService {
  private readonly logger = new Logger(ClerkAuthService.name);
  private client: MembershipClient | undefined;
  private readonly tokenCache = new Map<string, { claims: ClerkSessionClaims; verifiedAt: number }>();
  private readonly membershipCache = new Map<
    string,
    { memberships: WorkspaceMembership[]; fetchedAt: number }
  >();

  constructor(
    private readonly config: AuthConfig,
    private readonly verify: VerifyTokenFn = verifyToken,
    client?: MembershipClient,
  ) {
    // Test seam: a fake client can be injected; otherwise one is created
    // lazily on first use so the app can boot without CLERK_SECRET_KEY
    // in non-production environments.
    this.client = client;
  }

  /**
   * Verifies a Clerk session JWT signature/expiry and returns its claims.
   * Returns null on ANY failure (invalid signature, expired, malformed,
   * missing secret key, network error) so callers never leak the reason.
   * Verified tokens are cached for config.tokenCacheTtlMs to avoid
   * re-verifying on every request; the Clerk SDK additionally caches JWKS.
   */
  async verifyToken(token: string, correlationId?: string): Promise<ClerkSessionClaims | null> {
    const cached = this.tokenCache.get(token);
    const now = Date.now();
    if (cached && now - cached.verifiedAt < this.config.tokenCacheTtlMs) {
      return cached.claims;
    }

    if (!this.config.secretKey) {
      return null;
    }

    try {
      const claims = await this.verify(token, {
        secretKey: this.config.secretKey,
        authorizedParties: this.config.authorizedParties,
      });
      if (!claims) {
        return null;
      }
      const extracted = this.extractClaims(claims);
      this.tokenCache.set(token, { claims: extracted, verifiedAt: now });
      this.evictIfOversized(this.tokenCache);
      return extracted;
    } catch (err) {
      // Never log token contents; only that a verification failed.
      this.logger.debug(
        { correlationId: correlationId ?? "unknown", err: String(err) },
        "Token verification failed",
      );
      return null;
    }
  }

  /**
   * Resolves the Clerk organizations a user belongs to. Results are cached
   * for config.membershipCacheTtlMs to avoid a Clerk API round-trip on every
   * request.
   */
  async getOrganizationMemberships(
    userId: string,
    correlationId?: string,
  ): Promise<WorkspaceMembership[]> {
    const cached = this.membershipCache.get(userId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < this.config.membershipCacheTtlMs) {
      return cached.memberships;
    }

    try {
      const client = this.getClient();
      if (!client) {
        return [];
      }
      const res = await client.users.getOrganizationMembershipList({ userId });
      const memberships: WorkspaceMembership[] = res.data.map((membership) => ({
        workspaceId: membership.organization.id,
        role: membership.role,
      }));
      this.membershipCache.set(userId, { memberships, fetchedAt: now });
      this.evictIfOversized(this.membershipCache);
      return memberships;
    } catch (err) {
      this.logger.debug(
        { correlationId: correlationId ?? "unknown", userId, err: String(err) },
        "Membership resolution failed",
      );
      // A Clerk outage must never masquerade as "no membership": the guard
      // turns [] into 403, which would wrongly blame a valid user. Surface
      // the dependency failure as a typed 502 instead.
      throw new DependencyError("Clerk membership service unavailable");
    }
  }

  private getClient(): MembershipClient | undefined {
    if (this.client) {
      return this.client;
    }
    if (!this.config.secretKey) {
      return undefined;
    }
    this.client = createClerkClient({ secretKey: this.config.secretKey });
    return this.client;
  }

  private extractClaims(claims: Record<string, unknown>): ClerkSessionClaims {
    return {
      sub: String(claims.sub ?? ""),
      sid: typeof claims.sid === "string" ? claims.sid : undefined,
      email: typeof claims.email === "string" ? claims.email : undefined,
      exp: typeof claims.exp === "number" ? claims.exp : 0,
      orgId: typeof claims.org_id === "string" ? claims.org_id : undefined,
      orgRole: typeof claims.org_role === "string" ? claims.org_role : undefined,
    };
  }

  /**
   * Defensive cap: if a cache ever grows past 10k entries, drop it entirely
   * rather than scanning linearly per insert.
   */
  private evictIfOversized(cache: Map<string, unknown>): void {
    if (cache.size > 10_000) {
      cache.clear();
    }
  }
}
