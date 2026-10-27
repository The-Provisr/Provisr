"use client";

import { useEffect, useState } from "react";
import { isWorkspaceRole, type WorkspaceRole } from "@/components/layout/permissions";
import type { WorkspaceMembership } from "@/lib/orchestration/workspace-types";

export type WorkspaceRoleState =
  | { status: "loading" }
  | { status: "ready"; role: WorkspaceRole | null };

/**
 * Resolves the caller's role in the active workspace from the same
 * `/api/workspace/list` source DashboardShell uses for nav filtering.
 * Fails closed: any error yields `role: null`.
 */
export function useWorkspaceRole(): WorkspaceRoleState {
  const [state, setState] = useState<WorkspaceRoleState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/workspace/list", { cache: "no-store" });
        const body = (await res.json()) as {
          workspaces?: WorkspaceMembership[];
          activeWorkspaceId?: string | null;
        };
        const active = body.workspaces?.find((w) => w.id === body.activeWorkspaceId);
        const role = active && isWorkspaceRole(active.role) ? active.role : null;
        if (!cancelled) setState({ status: "ready", role });
      } catch {
        if (!cancelled) setState({ status: "ready", role: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
