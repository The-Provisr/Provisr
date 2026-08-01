import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { ProvError } from "../errors/typed-errors";

interface ErrorBody {
  error: string;
  message: string;
  status: number;
  request_id: string;
  code: string | undefined;
  details: unknown[] | undefined;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const requestId = res.locals.requestId ?? "unknown";
    const correlationId = res.locals.correlationId ?? "unknown";

    const body = this.toErrorBody(exception, requestId);

    if (body.status >= 500) {
      this.logger.error({ err: exception, correlationId, requestId }, "Unhandled error");
    } else {
      this.logger.warn({ correlationId, requestId, status: body.status }, "Request failed");
    }

    res.status(body.status).json(body);
  }

  private toErrorBody(exception: unknown, requestId: string): ErrorBody {
    if (exception instanceof ProvError) {
      return {
        error: exception.name,
        message: exception.message,
        status: exception.status,
        code: exception.code,
        request_id: requestId,
        details: exception.details,
      };
    }

    if (exception instanceof ZodError) {
      return {
        error: "ValidationError",
        message: "Request validation failed",
        status: 400,
        code: "VALIDATION_FAILED",
        request_id: requestId,
        details: exception.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      let message: string;
      if (typeof response === "string") {
        message = response;
      } else {
        const raw = (response as { message?: unknown }).message;
        message = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : exception.message;
      }
      return {
        error: HttpStatus[status] ?? "Error",
        message,
        status,
        code: undefined,
        request_id: requestId,
        details: undefined,
      };
    }

    return {
      error: "InternalServerError",
      message: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
      request_id: requestId,
      details: undefined,
    };
  }
}
