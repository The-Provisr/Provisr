import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { UnauthorizedError } from "../common/errors/typed-errors";
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

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- extracted now, consumed by OR-002
    const token = this.extractToken(req);

    // Dev bypass: only ever honored outside production, so a stray
    // DEV_USER_ID in a production deployment cannot authenticate anyone.
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

    // TODO(OR-002): verify `token` against Clerk JWKS and map to a RequestUser.
    // Until then, local development must set DEV_USER_ID.
    this.logger.warn("Auth guard in stub mode: set DEV_USER_ID to authenticate requests");
    throw new UnauthorizedError("Clerk JWT verification not implemented yet (OR-002)");
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
