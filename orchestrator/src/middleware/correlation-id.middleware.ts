import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = req.header(CORRELATION_ID_HEADER) ?? randomUUID();
    const requestId = randomUUID();

    res.locals.correlationId = correlationId;
    res.locals.requestId = requestId;

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    this.logger.log(
      { correlationId, requestId, method: req.method, path: req.path },
      "incoming request",
    );

    next();
  }
}
