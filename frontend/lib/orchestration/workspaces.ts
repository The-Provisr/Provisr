import "server-only";

export type WorkspaceEnvironment = "development" | "staging" | "production";

export type CreateWorkspaceInput = {
  name: string;
  description?: string;
  environment: WorkspaceEnvironment;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  environment: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WorkspaceCreateErrorCode =
  | "slug_taken"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "workspace_create_failed";

const CREATE_WORKSPACE_TIMEOUT_MS = 5000;

/**
 * Error surfaced when the orchestrator rejects a workspace creation. Carries the
 * upstream HTTP status so callers can map it (e.g. 409 → "name is taken")
 * without re-parsing the response envelope.
 */
export class WorkspaceCreateError extends Error {
  readonly code: WorkspaceCreateErrorCode;
  readonly status: number;

  constructor(status: number, code: WorkspaceCreateErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceCreateError";
    this.status = status;
    this.code = code;
  }
}

function codeForStatus(status: number): WorkspaceCreateErrorCode {
  switch (status) {
    case 409:
      return "slug_taken";
    case 400:
      return "validation_error";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    default:
      return "workspace_create_failed";
  }
}

async function readErrorBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a workspace through the orchestration gateway (OR-003 → BE-A03). The
 * creator is resolved from the authenticated token by the gateway; the body
 * carries only the fields the orchestrator schema accepts.
 */
export async function createWorkspace(
  token: string,
  input: CreateWorkspaceInput,
  idempotencyKey: string,
): Promise<WorkspaceRecord> {
  let res: Response;
  try {
    res = await fetch(`${process.env.ORCHESTRATION_API_URL}/v1/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        // Every mutation needs an idempotency key; safe to retry a torn submit.
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(CREATE_WORKSPACE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new WorkspaceCreateError(
        504,
        "workspace_create_failed",
        `createWorkspace timed out after ${CREATE_WORKSPACE_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    const message =
      typeof body?.message === "string"
        ? body.message
        : `createWorkspace failed: ${res.status}`;
    throw new WorkspaceCreateError(res.status, codeForStatus(res.status), message);
  }

  return (await res.json()) as WorkspaceRecord;
}
