import { auth } from "@clerk/nextjs/server";
import { listWorkspaces } from "@/lib/orchestration/workspaces";
import type { WorkspaceMembership } from "@/lib/orchestration/workspace-types";

/**
 * FE-M03: workspace list for the shell's workspace switcher and role-aware nav.
 *
 * The caller's membership role comes from BE-A03 (`GET /workspaces`). While the
 * orchestrator gateway is still a stub (OR-004 returns 501), this degrades to an
 * empty list with `degraded: true` rather than erroring — the shell then falls
 * back to showing all navigation and lets the server remain the real gate.
 */
export async function GET() {
  const { getToken, sessionClaims } = await auth.protect();
  const activeWorkspaceId = sessionClaims?.metadata?.workspaceId ?? null;

  const token = await getToken();
  if (!token) {
    return Response.json({ workspaces: [], activeWorkspaceId, degraded: true });
  }

  try {
    const workspaces = await listWorkspaces(token);
    return Response.json({ workspaces, activeWorkspaceId, degraded: false });
  } catch {
    return Response.json({
      workspaces: [] as WorkspaceMembership[],
      activeWorkspaceId,
      degraded: true,
    });
  }
}
