import "server-only";

import { isWorkspaceRole } from "@/components/layout/permissions";
import type {
  WorkspaceEnvironment,
  WorkspaceMembership,
  WorkspaceRecord,
} from "./workspace-types";

export type {
  WorkspaceEnvironment,
  WorkspaceMembership,
  WorkspaceRecord,
} from "./workspace-types";

export type CreateWorkspaceInput = {
  name: string;
  description?: string;
  environment: WorkspaceEnvironment;
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

const LIST_WORKSPACES_TIMEOUT_MS = 5000;

/**
 * List the workspaces the caller is a member of, with their role in each
 * (BE-A03 `GET /workspaces`). The gateway resolves the caller from the token, so
 * no `user_id` is sent from the client.
 *
 * BE-A03 returns a top-level array of `workspace + role`. Any item missing a
 * recognized role is downgraded to `viewer` rather than trusted, so a malformed
 * payload cannot widen the shell's navigation.
 */
export async function listWorkspaces(token: string): Promise<WorkspaceMembership[]> {
  let res: Response;
  try {
    res = await fetch(`${process.env.ORCHESTRATION_API_URL}/v1/workspaces`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(LIST_WORKSPACES_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`listWorkspaces timed out after ${LIST_WORKSPACES_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  if (!res.ok) {
    throw new Error(`listWorkspaces failed: ${res.status}`);
  }

  const body: unknown = await res.json();
  if (!Array.isArray(body)) {
    throw new Error("listWorkspaces returned an unexpected payload");
  }

  return body
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? ""),
      slug: String(item.slug ?? ""),
      environment: String(item.environment ?? ""),
      description: typeof item.description === "string" ? item.description : null,
      created_at: typeof item.created_at === "string" ? item.created_at : undefined,
      updated_at: typeof item.updated_at === "string" ? item.updated_at : undefined,
      role: isWorkspaceRole(item.role) ? item.role : "viewer",
    }));
}
