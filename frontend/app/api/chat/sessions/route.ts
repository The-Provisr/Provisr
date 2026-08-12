import { auth } from "@clerk/nextjs/server";
import { callChatApi } from "@/lib/orchestration/chat";

export async function POST(request: Request) {
  const { getToken } = await auth.protect();
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!isCreateSessionBody(body)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const response = await callChatApi(token, "/v1/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return proxyJson(response);
}

export async function GET(request: Request) {
  const { getToken } = await auth.protect();
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) return Response.json({ error: "missing_workspace_id" }, { status: 400 });
  const response = await callChatApi(token, `/v1/sessions?workspaceId=${encodeURIComponent(workspaceId)}`);
  return proxyJson(response);
}

function isCreateSessionBody(value: unknown): value is { workspaceId: string; title?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { workspaceId, title } = value as { workspaceId?: unknown; title?: unknown };
  return typeof workspaceId === "string" && workspaceId.length > 0 && (title === undefined || typeof title === "string");
}

async function proxyJson(response: Response): Promise<Response> {
  const body = await response.json().catch(() => ({ error: "orchestrator_response_invalid" }));
  return Response.json(body, { status: response.status });
}
