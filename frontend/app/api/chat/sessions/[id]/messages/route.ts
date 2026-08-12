import { auth } from "@clerk/nextjs/server";
import { callChatApi } from "@/lib/orchestration/chat";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { getToken } = await auth.protect();
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) return Response.json({ error: "missing_workspace_id" }, { status: 400 });
  const { id } = await context.params;
  const response = await callChatApi(token, `/v1/sessions/${encodeURIComponent(id)}/messages?workspaceId=${encodeURIComponent(workspaceId)}`);
  const body = await response.json().catch(() => ({ error: "orchestrator_response_invalid" }));
  return Response.json(body, { status: response.status });
}
