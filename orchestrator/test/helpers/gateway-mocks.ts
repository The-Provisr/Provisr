import { vi } from "vitest";
import type { Request, Response } from "express";
import type { GatewayRequestContext } from "../../src/routes/gateway-request";
import type { RequestUser } from "../../src/middleware/auth.types";

export function mockResponse(): Response {
  const res = {
    locals: { requestId: "req-1", correlationId: "corr-1" },
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

export function mockRequest(): Request {
  return {} as Request;
}

export function gatewayCtx(overrides: Partial<GatewayRequestContext> = {}): GatewayRequestContext {
  return { requestId: "req-1", correlationId: "corr-1", userId: "user-1", ...overrides };
}

export function requestUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    userId: "user-1",
    clerkId: "clerk-1",
    email: "user@provisr.io",
    workspaceIds: ["ws-1"],
    roles: {},
    ...overrides,
  };
}
