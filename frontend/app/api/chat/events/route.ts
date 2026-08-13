import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { getToken } = await auth.protect();
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) return Response.json({ error: "missing_workspace_id" }, { status: 400 });
  const after = url.searchParams.get("after") ?? "0";
  const baseUrl = process.env.ORCHESTRATION_API_URL;
  if (!baseUrl) return Response.json({ error: "orchestrator_unavailable" }, { status: 503 });

  const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/workspaces/${encodeURIComponent(workspaceId)}/events?after=${encodeURIComponent(after)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "event_stream_unavailable" }, { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
