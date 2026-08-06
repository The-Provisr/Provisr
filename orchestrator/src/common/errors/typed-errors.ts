export const ErrorCodes = {
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ProvError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown[] | undefined;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class NotFoundError extends ProvError {
  constructor(message: string) {
    super(ErrorCodes.NOT_FOUND, message, 404);
  }
}

export class ConflictError extends ProvError {
  constructor(message: string) {
    super(ErrorCodes.CONFLICT, message, 409);
  }
}

export class UnauthorizedError extends ProvError {
  constructor(message = "Authentication required") {
    super(ErrorCodes.UNAUTHORIZED, message, 401);
  }
}

export class ForbiddenError extends ProvError {
  constructor(message = "You do not have permission to perform this action") {
    super(ErrorCodes.FORBIDDEN, message, 403);
  }
}

export class ValidationError extends ProvError {
  constructor(message: string, details?: unknown[]) {
    super(ErrorCodes.VALIDATION_FAILED, message, 400, details);
  }
}

export class NotImplementedError extends ProvError {
  constructor(domain: string) {
    super(ErrorCodes.NOT_IMPLEMENTED, `${domain} is not implemented yet`, 501);
  }
}
