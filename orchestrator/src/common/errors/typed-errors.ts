export const ErrorCodes = {
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ProvError extends Error {
  // Not restricted to ErrorCodes: upstream services return domain slugs
  // (e.g. "revoked", "last_admin", "email_mismatch") that the frontend needs
  // to branch on, so the envelope must preserve them verbatim.
  readonly code: string;
  readonly status: number;
  readonly details: unknown[] | undefined;

  constructor(code: string, message: string, status: number, details?: unknown[]) {
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

export class DependencyError extends ProvError {
  constructor(message: string) {
    super(ErrorCodes.DEPENDENCY_UNAVAILABLE, message, 502);
  }
}

/**
 * A non-2xx response from an internal service. The upstream HTTP status and
 * domain error slug are preserved so callers can distinguish, for example,
 * a revoked invitation (410 / "revoked") from a duplicate membership
 * (409 / "already_member").
 */
export class UpstreamError extends ProvError {
  constructor(status: number, code: string, message: string, details?: unknown[]) {
    super(code, message, status, details);
  }
}
