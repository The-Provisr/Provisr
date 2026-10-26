// FE-M03: workspace role model for the dashboard shell.
//
// Roles and their capabilities mirror the BE-A03 workspace service
// (backend/cmd/workspace-service/permissions.go). That matrix is action-based
// (`resource.action`); the shell needs a screen-level projection of it so nav
// items can be hidden for roles that cannot use them. This is a *navigation*
// gate only — it is not a security boundary. Every server endpoint must enforce
// the real permission check (never trust the shell hiding a link).

export type WorkspaceRole = "admin" | "engineer" | "approver" | "auditor" | "viewer";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "admin",
  "engineer",
  "approver",
  "auditor",
  "viewer",
];

export type NavScreen =
  | "chat"
  | "dashboard"
  | "cloud_accounts"
  | "team"
  | "policy"
  | "approvals"
  | "resources"
  | "audit"
  | "billing";

/**
 * Screen → roles allowed to reach it. `"all"` means every role (used where the
 * BE-A03 matrix grants the underlying action to every role, e.g.
 * `provisioning_run.view`, or where the backend has no screen-level gate yet).
 * An empty array means admin-only (admin is a hard bypass, exactly like
 * `isActionAllowed` in permissions.go).
 *
 * Mapping back to BE-A03 actions:
 * - chat            → `chat_session.view`        (engineer, viewer)
 * - dashboard       → `provisioning_run.view`     (all roles)
 * - cloud_accounts  → `cloud_account.view`        (engineer)
 * - team             → no backend gate; membership admin-only
 * - policy           → no backend gate; matches existing frontend admin gate
 * - approvals       → `approval_ticket.decide`    (approver)
 * - resources       → `manifest.view` / `artifact.view` (engineer, auditor)
 * - audit           → `audit_event.view`          (auditor)
 * - billing         → not in the BE-A03 matrix    (admin-only)
 */
const SCREEN_ACCESS: Record<NavScreen, readonly WorkspaceRole[] | "all"> = {
  chat: ["engineer", "viewer"],
  dashboard: "all",
  cloud_accounts: ["engineer"],
  team: [],
  policy: [],
  approvals: ["approver"],
  resources: ["engineer", "auditor"],
  audit: ["auditor"],
  billing: [],
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** Unknown membership exposes only the unrestricted dashboard until validated. */
export function canAccessScreen(
  role: WorkspaceRole | null | undefined,
  screen: NavScreen,
): boolean {
  if (!role) return screen === "dashboard";
  if (role === "admin") return true;
  const allowed = SCREEN_ACCESS[screen];
  if (allowed === "all") return true;
  return allowed.includes(role);
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  admin: "Admin",
  engineer: "Engineer",
  approver: "Approver",
  auditor: "Auditor",
  viewer: "Viewer",
};
