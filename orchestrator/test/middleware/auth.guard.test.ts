import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it } from "vitest";
import { IS_PUBLIC_KEY } from "../../src/middleware/public.decorator";
import { AuthGuard } from "../../src/middleware/auth.guard";
import { UnauthorizedError } from "../../src/common/errors/typed-errors";

const handler = (): void => undefined;
const clazz = class FakeController {};
const SSE_PATH = "/v1/workspaces/f47ac10b-58cc-4372-a567-0e02b2c3d479/events";

function mockContext(
  opts: {
    authHeader?: string;
    method?: string;
    query?: Record<string, unknown>;
    originalUrl?: string;
  } = {},
): ExecutionContext {
  const req = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? opts.authHeader : undefined,
    method: opts.method ?? "GET",
    query: opts.query ?? {},
    originalUrl: opts.originalUrl ?? "/v1/workspaces",
  };

  return {
    getHandler: () => handler,
    getClass: () => clazz,
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
  let guard: AuthGuard;

  beforeEach(() => {
    delete process.env.DEV_USER_ID;
    Reflect.deleteMetadata(IS_PUBLIC_KEY, handler);
    Reflect.deleteMetadata(IS_PUBLIC_KEY, clazz);
    guard = new AuthGuard(new Reflector());
  });

  it("lets @Public handlers through without a user", () => {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    const context = mockContext({});
    expect(guard.canActivate(context)).toBe(true);
  });

  it("lets @Public classes through without a user", () => {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, clazz);
    const context = mockContext({});
    expect(guard.canActivate(context)).toBe(true);
  });

  describe("dev mode (DEV_USER_ID set, not production)", () => {
    beforeEach(() => {
      process.env.DEV_USER_ID = "user-123";
    });

    it("accepts a request with no token and populates the user", () => {
      const context = mockContext({});
      const req = context.switchToHttp().getRequest<{ user?: { userId: string } }>();

      expect(guard.canActivate(context)).toBe(true);
      expect(req.user?.userId).toBe("user-123");
    });

    it("accepts a request with a Bearer token", () => {
      expect(guard.canActivate(mockContext({ authHeader: "Bearer abc.def.ghi" }))).toBe(true);
    });

    it("accepts a GET with a query token on the SSE event stream", () => {
      const context = mockContext({
        method: "GET",
        query: { token: "sse-token" },
        originalUrl: `${SSE_PATH}?token=sse-token`,
      });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe("production-like (no DEV_USER_ID)", () => {
    it("rejects a request without a token", () => {
      expect(() => guard.canActivate(mockContext({}))).toThrowError(UnauthorizedError);
    });

    it("throws UnauthorizedError with the OR-002 contract", () => {
      try {
        guard.canActivate(mockContext({}));
        throw new Error("expected UnauthorizedError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedError);
        const e = err as UnauthorizedError;
        expect(e.code).toBe("UNAUTHORIZED");
        expect(e.status).toBe(401);
        expect(e.message).toBe("Clerk JWT verification not implemented yet (OR-002)");
      }
    });

    it("rejects even when a Bearer token is present (OR-002 stub ignores it)", () => {
      expect(() =>
        guard.canActivate(mockContext({ authHeader: "Bearer abc.def.ghi" })),
      ).toThrowError(UnauthorizedError);
    });

    it("disables the dev bypass when NODE_ENV is production", () => {
      const previous = process.env.NODE_ENV;
      process.env.DEV_USER_ID = "user-123";
      process.env.NODE_ENV = "production";
      try {
        expect(() => guard.canActivate(mockContext({}))).toThrowError(UnauthorizedError);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });
  });
});
