import { auth } from "@clerk/nextjs/server";
import { listWorkspaces } from "@/lib/orchestration/workspaces";
import type { WorkspaceMembership } from "@/lib/orchestration/workspace-types";

/** Authenticated memberships supply roles; unavailable listings remain fail-closed. */
export async function GET() {
  const { getToken, sessionClaims } = await auth.protect();
  const activeWorkspaceId = sessionClaims?.metadata?.workspaceId ?? null;

  const token = await getToken();
  if (!token) {
    return Response.json({ workspaces: [], activeWorkspaceId, degraded: true });
  }

  try {
    const workspaces = await listWorkspaces(token);
    return Response.json({
      workspaces,
      activeWorkspaceId: workspaces.some((workspace) => workspace.id === activeWorkspaceId)
        ? activeWorkspaceId : null,
      degraded: false,
    });
  } catch {
    return Response.json({
      workspaces: [] as WorkspaceMembership[],
      activeWorkspaceId,
      degraded: true,
    });
  }
}
