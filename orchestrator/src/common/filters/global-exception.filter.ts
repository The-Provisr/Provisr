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
import { ErrorCodes, ProvError, type ErrorCode } from "../errors/typed-errors";

interface ErrorBody {
  error: string;
  message: string;
  status: number;
  request_id: string;
  code: string | undefined;
  details: unknown[] | undefined;
}

/** Maps a plain HTTP status to the stable application error code. */
const STATUS_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCodes.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCodes.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCodes.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCodes.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCodes.CONFLICT,
  [HttpStatus.NOT_IMPLEMENTED]: ErrorCodes.NOT_IMPLEMENTED,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCodes.INTERNAL_ERROR,
};

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
      this.logger.error(
        { err: exception, correlation_id: correlationId, request_id: requestId },
        exception instanceof Error ? exception.stack : undefined,
        "Unhandled error",
      );
    } else {
      this.logger.warn({ correlation_id: correlationId, request_id: requestId, status: body.status }, "Request failed");
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
        code: STATUS_CODE[status] ?? (status >= 500 ? ErrorCodes.INTERNAL_ERROR : undefined),
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
