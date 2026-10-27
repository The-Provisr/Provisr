import "server-only";

import { auth } from "@clerk/nextjs/server";
import {
  forward,
  gatewayAuth,
  jsonResult,
  noWorkspaceResponse,
} from "@/lib/cloud-accounts/server";

function unauthorizedResponse(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

async function readBody(req: Request): Promise<{ ok: true; body: string } | { ok: false }> {
  try {
    return { ok: true, body: JSON.stringify(await req.json()) };
  } catch {
    return { ok: false };
  }
}

function idempotencyHeaders(req: Request): { headers?: Record<string, string> } {
  const key = req.headers.get("Idempotency-Key");
  return key ? { headers: { "Idempotency-Key": key } } : {};
}

/**
 * Proxies a workspace-scoped team call to OR-M02. The workspace id always
 * comes from the session claim, never from the browser.
 */
export async function proxyWorkspace(
  req: Request,
  subpath: string,
  options: { method?: string; withBody?: boolean } = {},
): Promise<Response> {
  const gateway = await gatewayAuth();
  if (gateway.workspaceId === null) {
    return noWorkspaceResponse();
  }
  const method = options.method ?? "GET";
  let body: string | undefined;
  if (options.withBody) {
    const parsed = await readBody(req);
    if (!parsed.ok) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    body = parsed.body;
  }
  const result = await forward(
    gateway.token,
    `/v1/workspaces/${gateway.workspaceId}${subpath}`,
    {
      method,
      ...(body !== undefined ? { body } : {}),
      ...(method === "GET" ? {} : idempotencyHeaders(req)),
    },
  );
  return jsonResult(result);
}

/**
 * Proxies an invitation lookup/accept call. These run before the invitee has
 * any workspace, so only a session token is required, not a workspace claim.
 */
export async function proxyInvitation(
  req: Request,
  path: string,
  options: { method?: string; withBody?: boolean } = {},
): Promise<Response> {
  const { getToken } = await auth.protect();
  const token = await getToken();
  if (!token) {
    return unauthorizedResponse();
  }
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) {
    return Response.json(
      { error: "missing_code", message: "An invitation code is required." },
      { status: 400 },
    );
  }
  const method = options.method ?? "GET";
  let body: string | undefined;
  if (options.withBody) {
    const parsed = await readBody(req);
    if (!parsed.ok) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    body = parsed.body;
  }
  const result = await forward(token, `${path}?code=${encodeURIComponent(code)}`, {
    method,
    ...(body !== undefined ? { body } : {}),
    ...(method === "GET" ? {} : idempotencyHeaders(req)),
  });
  return jsonResult(result);
}
