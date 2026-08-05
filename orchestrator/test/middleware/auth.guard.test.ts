import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../../src/middleware/public.decorator";
import { AuthGuard, extractBearerToken, isSseEventsPath } from "../../src/middleware/auth.guard";
import { UnauthorizedError, ForbiddenError } from "../../src/common/errors/typed-errors";
import { ClerkAuthService } from "../../src/auth/clerk-auth.service";
import { IdentityService } from "../../src/auth/identity.service";

const handler = (): void => undefined;
const clazz = class FakeController {};
const SSE_PATH = "/v1/workspaces/f47ac10b-58cc-4372-a567-0e02b2c3d479/events";

const VALID_CLAIMS = {
  sub: "clerk_user_1",
  sid: "sess_1",
  email: "user@provisr.io",
  exp: Math.floor(Date.now() / 1000) + 3600,
  orgId: undefined,
  orgRole: undefined,
};

function mockContext(
  opts: {
    authHeader?: string;
    method?: string;
    query?: Record<string, unknown>;
    originalUrl?: string;
    correlationId?: string;
  } = {},
): ExecutionContext {
  const req = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? opts.authHeader : undefined,
    method: opts.method ?? "GET",
    query: opts.query ?? {},
    originalUrl: opts.originalUrl ?? "/v1/workspaces",
  };
  const res = { locals: { correlationId: opts.correlationId ?? "trace-abc-123" } };

  return {
    getHandler: () => handler,
    getClass: () => clazz,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

interface Harness {
  guard: AuthGuard;
  verify: ReturnType<typeof vi.fn>;
  memberships: ReturnType<typeof vi.fn>;
  resolveMemberships: ReturnType<typeof vi.fn>;
}

function harness(opts: { verifyReturns?: unknown; memberships?: unknown[] } = {}): Harness {
  const verify = vi.fn(async () => opts.verifyReturns === undefined ? VALID_CLAIMS : opts.verifyReturns);
  const memberships = vi.fn(
    async () => opts.memberships ?? [{ workspaceId: "org_1", role: "org:admin" }],
  );
  const resolveMemberships = vi.fn(async () => memberships());
  const clerk = {
    verifyToken: verify,
    getOrganizationMemberships: memberships,
  } as unknown as ClerkAuthService;
  const identity = {
    getOrCreateUser: vi.fn(async () => ({
      userId: "prov-user-1",
      clerkId: "clerk_user_1",
      email: "user@provisr.io",
      createdAt: new Date().toISOString(),
    })),
    resolveMemberships,
  } as unknown as IdentityService;

  return { guard: new AuthGuard(new Reflector(), clerk, identity), verify, memberships, resolveMemberships };
}

describe("AuthGuard", () => {
  beforeEach(() => {
    delete process.env.DEV_USER_ID;
    Reflect.deleteMetadata(IS_PUBLIC_KEY, handler);
    Reflect.deleteMetadata(IS_PUBLIC_KEY, clazz);
  });

  it("lets @Public handlers through without a user", async () => {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    const { guard } = harness();
    expect(await guard.canActivate(mockContext({}))).toBe(true);
  });

  it("lets @Public classes through without a user", async () => {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, clazz);
    const { guard } = harness();
    expect(await guard.canActivate(mockContext({}))).toBe(true);
  });

  describe("real token verification", () => {
    it("verifies a Bearer token and attaches the full user context", async () => {
      const { guard } = harness();
      const context = mockContext({ authHeader: "Bearer jwt.token.here" });
      const req = context.switchToHttp().getRequest<{ user?: { userId: string; workspaceIds: string[]; roles: Record<string, string> } }>();

      expect(await guard.canActivate(context)).toBe(true);
      expect(req.user).toEqual({
        userId: "prov-user-1",
        clerkId: "clerk_user_1",
        email: "user@provisr.io",
        workspaceIds: ["org_1"],
        roles: { org_1: "org:admin" },
      });
    });

    it("rejects an invalid token with a generic 401", async () => {
      const { guard } = harness({ verifyReturns: null });
      await expect(guard.canActivate(mockContext({ authHeader: "Bearer bad.token" }))).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it("rejects with 401 when no token is present (no reason revealed)", async () => {
      const { guard } = harness();
      await expect(guard.canActivate(mockContext({}))).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("rejects with 401 without revealing the reason in the message", async () => {
      const { guard } = harness({ verifyReturns: null });
      try {
        await guard.canActivate(mockContext({ authHeader: "Bearer bad.token" }));
        throw new Error("expected UnauthorizedError to be thrown");
      } catch (err) {
        const e = err as UnauthorizedError;
        expect(e.message).toBe("Authentication required");
      }
    });

    it("returns 403 for a valid token with no workspace membership", async () => {
      const { guard } = harness({ memberships: [] });
      await expect(guard.canActivate(mockContext({ authHeader: "Bearer jwt.token.here" }))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("verifies a query token on the SSE event-stream route", async () => {
      const { guard, verify } = harness();
      const context = mockContext({
        method: "GET",
        query: { token: "sse-token" },
        originalUrl: `${SSE_PATH}?token=sse-token`,
      });

      expect(await guard.canActivate(context)).toBe(true);
      expect(verify).toHaveBeenCalledWith("sse-token", "trace-abc-123");
    });

    it("passes the request correlation id into verification and membership resolution", async () => {
      const { guard, verify, resolveMemberships } = harness();
      const context = mockContext({
        authHeader: "Bearer jwt.token.here",
        correlationId: "trace-abc-123",
      });

      expect(await guard.canActivate(context)).toBe(true);
      expect(verify).toHaveBeenCalledWith("jwt.token.here", "trace-abc-123");
      expect(resolveMemberships).toHaveBeenCalledWith("clerk_user_1", "trace-abc-123");
    });

    it("never reads a query token on a non-SSE route", async () => {
      const { guard, verify } = harness();
      const context = mockContext({
        method: "GET",
        query: { token: "sneaky-token" },
        originalUrl: "/v1/workspaces?token=sneaky-token",
      });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe("dev mode (DEV_USER_ID set, not production)", () => {
    beforeEach(() => {
      process.env.DEV_USER_ID = "user-123";
    });

    it("accepts a request with no token and populates the user", async () => {
      const { guard } = harness();
      const context = mockContext({});
      const req = context.switchToHttp().getRequest<{ user?: { userId: string } }>();

      expect(await guard.canActivate(context)).toBe(true);
      expect(req.user?.userId).toBe("user-123");
    });

    it("does not verify tokens in dev bypass mode", async () => {
      const { guard, verify } = harness();
      await guard.canActivate(mockContext({ authHeader: "Bearer abc.def.ghi" }));
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe("production-like (no DEV_USER_ID)", () => {
    it("disables the dev bypass when NODE_ENV is production", async () => {
      const { guard } = harness();
      const previous = process.env.NODE_ENV;
      const previousDevUser = process.env.DEV_USER_ID;
      process.env.DEV_USER_ID = "user-123";
      process.env.NODE_ENV = "production";
      try {
        await expect(guard.canActivate(mockContext({}))).rejects.toBeInstanceOf(UnauthorizedError);
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previous;
        }
        if (previousDevUser === undefined) {
          delete process.env.DEV_USER_ID;
        } else {
          process.env.DEV_USER_ID = previousDevUser;
        }
      }
    });
  });
});

describe("extractBearerToken", () => {
  it.each([
    ["Bearer abc.def", "abc.def"],
    ["bearer abc.def", "abc.def"],
    ["BEARER abc.def", "abc.def"],
    ["Bearer   abc.def  ", "abc.def"],
  ])("extracts the token from %j (case-insensitive scheme)", (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });

  it("rejects a missing header", () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it.each(["Basic abc.def", "Bearer", "Bearer "])("rejects %j", (header) => {
    expect(extractBearerToken(header)).toBeUndefined();
  });
});

describe("isSseEventsPath", () => {
  it("matches the SSE event-stream route", () => {
    expect(isSseEventsPath("/v1/workspaces/f47ac10b-58cc-4372-a567-0e02b2c3d479/events")).toBe(true);
  });

  it.each(["/v1/workspaces", "/v1/workspaces/f47ac10b-58cc-4372-a567-0e02b2c3d479", "/v1/runs"])(
    "rejects %j",
    (path) => {
      expect(isSseEventsPath(path)).toBe(false);
    },
  );
});
