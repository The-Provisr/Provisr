import type { WorkspaceRole } from "@/components/layout/permissions";

export type WorkspaceEnvironment = "development" | "staging" | "production";

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  environment: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
};

/**
 * A workspace plus the caller's membership role, as returned by BE-A03
 * `GET /workspaces` (see `backend/cmd/workspace-service/main.go`).
 */
export type WorkspaceMembership = WorkspaceRecord & { role: WorkspaceRole };
