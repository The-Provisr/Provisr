import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ForbiddenError, UnauthorizedError } from "../common/errors/typed-errors";
import { ClerkAuthService } from "../auth/clerk-auth.service";
import { IdentityService } from "../auth/identity.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { RequestUser } from "./auth.types";

const SSE_EVENTS_PATH_PATTERN = /\/workspaces\/[^/]+\/events$/;

export function isSseEventsPath(pathname: string): boolean {
  return SSE_EVENTS_PATH_PATTERN.test(pathname);
}

// RFC 6750: the Bearer scheme is case-insensitive.
export function extractBearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

/**
 * Authenticates every protected request (PRD §19):
 *  1. extract a Clerk session JWT from the Authorization header, or from the
 *     query string on SSE event-stream routes (EventSource cannot set headers);
 *  2. verify it against the cached Clerk JWKS endpoint (ClerkAuthService);
 *  3. map the Clerk identity to an internal Provisr user, creating it on the
 *     fly if unknown, and resolve workspace memberships (IdentityService);
 *  4. attach the resolved context to req.user for downstream handlers.
 *
 * Failures are deliberately opaque: invalid/expired tokens always yield one
 * generic 401 with no reason. A valid token with no workspace membership
 * yields 403.
 *
 * Development bypass: when NODE_ENV is not "production" and DEV_USER_ID is
 * set, the request is authenticated as that user without any token. The
 * bypass is never honored in production, so a stray DEV_USER_ID cannot
 * authenticate anyone there.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly clerk: ClerkAuthService,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();

    if (process.env.NODE_ENV !== "production" && process.env.DEV_USER_ID) {
      req.user = {
        userId: process.env.DEV_USER_ID,
        clerkId: process.env.DEV_USER_ID,
        email: "dev@provisr.local",
        workspaceIds: [],
        roles: {},
      };
      return true;
    }

    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedError();
    }

    const claims = await this.clerk.verifyToken(token);
    if (!claims) {
      // One generic message for every failure mode; never reveal the reason.
      throw new UnauthorizedError();
    }

    const user = await this.identity.getOrCreateUser(claims);
    const memberships = await this.identity.resolveMemberships(user.clerkId);

    if (memberships.length === 0) {
      throw new ForbiddenError("No workspace membership");
    }

    req.user = {
      userId: user.userId,
      clerkId: user.clerkId,
      email: user.email,
      workspaceIds: memberships.map((membership) => membership.workspaceId),
      roles: Object.fromEntries(memberships.map((membership) => [membership.workspaceId, membership.role])),
    };
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const headerToken = extractBearerToken(req.header("authorization"));
    if (headerToken) {
      return headerToken;
    }

    // SSE via EventSource cannot set Authorization headers (browser limitation),
    // so allow the token as a query parameter for the SSE event-stream routes
    // only. Query tokens on any other endpoint would leak into access logs,
    // proxies and browser history. The query string is deliberately not logged
    // by CorrelationIdMiddleware.
    const pathname = (req.originalUrl ?? "").split("?")[0] ?? "";
    if (req.method === "GET" && isSseEventsPath(pathname)) {
      const queryToken = req.query["token"];
      if (typeof queryToken === "string" && queryToken.length > 0) {
        return queryToken;
      }
    }

    return undefined;
  }
}
