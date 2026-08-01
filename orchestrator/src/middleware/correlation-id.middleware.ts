import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: Request, res: Response, next: NextFunction): void {
    // Only echo back well-formed correlation ids; anything else (or missing)
    // falls back to a fresh UUID to keep log lines clean and injection-free.
    const incoming = req.header(CORRELATION_ID_HEADER);
    const correlationId =
      incoming !== undefined && SAFE_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    const requestId = randomUUID();

    res.locals.correlationId = correlationId;
    res.locals.requestId = requestId;

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    // `req.path` is stripped to "/" by the time route-level middleware runs,
    // so use the original URL. Never log the query string: SSE tokens travel as
    // a `?token=` query parameter and must not appear in logs.
    const pathname = req.originalUrl.split("?")[0];

    this.logger.log(
      { correlationId, requestId, method: req.method, path: pathname },
      "incoming request",
    );

    next();
  }
}
