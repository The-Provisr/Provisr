import "server-only";

import { auth } from "@clerk/nextjs/server";

/** Reads the caller's workspace id from the reconciled Clerk session claim. */
export function workspaceIdFromClaims(
  claims: { metadata?: { workspaceId?: unknown } } | null | undefined,
): string | null {
  const value = claims?.metadata?.workspaceId;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export type GatewayAuth = {
  token: string;
  workspaceId: string;
};

/**
 * Authenticates the request and returns the bearer token plus workspace id.
 * Throws (via auth.protect) for signed-out callers; returns null when the
 * session has no workspace yet, so the route can answer 409 rather than
 * forwarding an unscoped request.
 */
export async function gatewayAuth(): Promise<GatewayAuth | { workspaceId: null }> {
  const { getToken, sessionClaims } = await auth.protect();
  const token = await getToken();
  if (!token) {
    return { workspaceId: null };
  }
  const workspaceId = workspaceIdFromClaims(sessionClaims);
  return { token, workspaceId };
}

export function orchestrationApiUrl(): string {
  const url = process.env.ORCHESTRATION_API_URL;
  if (!url) {
    throw new Error("ORCHESTRATION_API_URL must be configured");
  }
  return url.replace(/\/+$/, "");
}

export type ProxyResult = {
  status: number;
  body: unknown;
};

/**
 * Forwards to the orchestrator gateway and returns the status and parsed body.
 * The orchestrator's error envelope is passed through unchanged so the client
 * keeps the domain `code` (e.g. `provider_slot_taken`).
 */
export async function forward(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<ProxyResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const idempotencyKey = (init?.headers as Record<string, string> | undefined)?.[
    "Idempotency-Key"
  ];
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetch(`${orchestrationApiUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (res.status === 204) {
    return { status: 204, body: null };
  }

  const text = await res.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  return { status: res.status, body };
}

export function jsonResult(result: ProxyResult): Response {
  if (result.status === 204) {
    return new Response(null, { status: 204 });
  }
  return Response.json(result.body ?? {}, { status: result.status });
}

/** 409 when the signed-in user has no workspace to scope cloud accounts to. */
export function noWorkspaceResponse(): Response {
  return Response.json(
    { error: "no_workspace", message: "No workspace is associated with this session." },
    { status: 409 },
  );
}
