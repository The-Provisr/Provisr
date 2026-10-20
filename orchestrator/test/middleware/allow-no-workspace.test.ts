import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../../src/middleware/auth.guard";
import { AllowNoWorkspaceMembership } from "../../src/middleware/allow-no-workspace.decorator";
import { ForbiddenError } from "../../src/common/errors/typed-errors";
import { ClerkAuthService } from "../../src/auth/clerk-auth.service";
import { IdentityService } from "../../src/auth/identity.service";

class InviteController {
  @AllowNoWorkspaceMembership()
  accept(): void {
    // decorated handler under test
  }
}

class PlainController {
  accept(): void {
    // undecorated handler under test
  }
}

interface MockRequest {
  header: (name: string) => string | undefined;
  method: string;
  query: Record<string, unknown>;
  originalUrl: string;
  user?: { userId: string; workspaceIds: string[] };
}

function contextFor(method: () => void, clazz: unknown): { context: ExecutionContext; req: MockRequest } {
  const req: MockRequest = {
    header: (name) => (name.toLowerCase() === "authorization" ? "Bearer jwt.token.here" : undefined),
    method: "GET",
    query: {},
    originalUrl: "/v1/invitations",
  };
  const res = { locals: { correlationId: "corr-1" } };
  const context = {
    getHandler: () => method,
    getClass: () => clazz,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, req };
}

function guardWithNoMemberships(): AuthGuard {
  const clerk = {
    verifyToken: vi.fn(async () => ({ sub: "clerk_1", sid: "sess_1", email: "u@provisr.io", exp: 9999999999 })),
  } as unknown as ClerkAuthService;
  const identity = {
    getOrCreateUser: vi.fn(async () => ({ userId: "prov-user-1", clerkId: "clerk_1", email: "u@provisr.io" })),
    resolveMemberships: vi.fn(async () => []),
  } as unknown as IdentityService;
  return new AuthGuard(new Reflector(), clerk, identity);
}

describe("AuthGuard @AllowNoWorkspaceMembership", () => {
  beforeEach(() => {
    delete process.env.DEV_USER_ID;
    delete process.env.AUTH_DEV_BYPASS;
  });
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it("rejects a zero-membership user on an ordinary route", async () => {
    const guard = guardWithNoMemberships();
    const { context } = contextFor(PlainController.prototype.accept, PlainController);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a zero-membership user through on a decorated route and attaches the user", async () => {
    const guard = guardWithNoMemberships();
    const { context, req } = contextFor(InviteController.prototype.accept, InviteController);

    expect(await guard.canActivate(context)).toBe(true);
    expect(req.user).toEqual({
      userId: "prov-user-1",
      clerkId: "clerk_1",
      email: "u@provisr.io",
      workspaceIds: [],
      roles: {},
    });
  });
});
