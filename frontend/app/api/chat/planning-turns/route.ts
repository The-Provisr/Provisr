import { auth } from "@clerk/nextjs/server";
import { callChatApi } from "@/lib/orchestration/chat";

export async function POST(request: Request) {
  const { getToken } = await auth.protect();
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!isPlanningTurnBody(body)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const response = await callChatApi(token, "/v1/runs/planning-turns", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({ error: "orchestrator_response_invalid" }));
  return Response.json(responseBody, { status: response.status });
}

function isPlanningTurnBody(value: unknown): value is {
  sessionId: string; workspaceId: string; prompt: string; clientMessageId: string; idempotencyKey: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return ["sessionId", "workspaceId", "prompt", "clientMessageId", "idempotencyKey"].every((key) => typeof body[key] === "string" && body[key].length > 0);
}
