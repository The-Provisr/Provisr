import type { Request, Response } from "express";
import type { RequestUser } from "../middleware/auth.types";
import type { UpstreamResult } from "../services/upstream-client";

export interface GatewayRequestContext {
  requestId: string;
  correlationId: string;
  userId: string;
  idempotencyKey?: string;
}

/**
 * Builds the per-request context forwarded to internal services. The request
 * and correlation ids come from res.locals set by CorrelationIdMiddleware; the
 * user id is always the authenticated internal user, never a client value.
 */
export function gatewayContext(
  _req: Request,
  res: Response,
  user: RequestUser,
  idempotencyKey?: string,
): GatewayRequestContext {
  const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
  const correlationId =
    typeof res.locals.correlationId === "string" ? res.locals.correlationId : "unknown";

  return {
    requestId,
    correlationId,
    userId: user.userId,
    ...(idempotencyKey !== undefined && idempotencyKey.length > 0 ? { idempotencyKey } : {}),
  };
}

/**
 * Sends an upstream result through with its exact status and body (e.g. 201 on
 * create, 204 on delete). Using @Res() rather than @HttpCode keeps the status
 * faithful to the backend contract.
 */
export function sendUpstream(res: Response, result: UpstreamResult): void {
  if (result.status === 204 || result.body === undefined) {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.body);
}
