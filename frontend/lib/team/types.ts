import type { WorkspaceRole } from "@/components/layout/permissions";

/** A workspace member as returned by BE-A03 `GET /workspaces/:id/members`. */
export type Member = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joined_at: string;
};

/** A workspace invitation as returned by BE-A03. Expiry is fixed server-side at 7 days. */
export type Invitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  code: string;
  expires_at: string;
  created_at: string;
  revoked_at?: string | null;
};

/** Error surfaced by the team client. `code` carries the BE-A03 slug (e.g. `last_admin`). */
export class TeamError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "TeamError";
    this.status = status;
    this.code = code;
  }
}
