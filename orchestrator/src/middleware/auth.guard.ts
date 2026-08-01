import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import { UnauthorizedError } from "../common/errors/typed-errors";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { RequestUser } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const isPublic =
      Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) ??
      Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass());

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- extracted now, consumed by OR-002
    const token = this.extractToken(req);

    if (process.env.DEV_USER_ID) {
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
    const header = req.header("authorization");
    if (header && header.startsWith("Bearer ")) {
      const token = header.slice("Bearer ".length).trim();
      if (token) {
        return token;
      }
    }

    // SSE via EventSource cannot set Authorization headers (browser limitation),
    // so allow the token as a query parameter for GET requests only.
    if (req.method === "GET") {
      const queryToken = req.query["token"];
      if (typeof queryToken === "string" && queryToken.length > 0) {
        return queryToken;
      }
    }

    return undefined;
  }
}
