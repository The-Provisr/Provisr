import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ROLES,
  canAccessScreen,
  isWorkspaceRole,
  type WorkspaceRole,
} from "./permissions";

describe("canAccessScreen", () => {
  const visibleScreens = (role: WorkspaceRole) =>
    (
      [
        "chat",
        "dashboard",
        "cloud_accounts",
        "team",
        "policy",
        "approvals",
        "resources",
        "audit",
        "billing",
      ] as const
    ).filter((screen) => canAccessScreen(role, screen));

  it("grants admin every screen", () => {
    expect(visibleScreens("admin")).toHaveLength(9);
  });

  it("limits engineers to chat, dashboard, cloud accounts and resources", () => {
    expect(visibleScreens("engineer")).toEqual([
      "chat",
      "dashboard",
      "cloud_accounts",
      "resources",
    ]);
  });

  it("limits approvers to dashboard and approvals", () => {
    expect(visibleScreens("approver")).toEqual(["dashboard", "approvals"]);
  });

  it("limits auditors to dashboard, resources and audit", () => {
    expect(visibleScreens("auditor")).toEqual(["dashboard", "resources", "audit"]);
  });

  it("limits viewers to chat and dashboard", () => {
    expect(visibleScreens("viewer")).toEqual(["chat", "dashboard"]);
  });

  it("keeps restricted screens hidden for an unknown role", () => {
    expect(canAccessScreen(null, "dashboard")).toBe(true);
    expect(canAccessScreen(null, "billing")).toBe(false);
    expect(canAccessScreen(undefined, "team")).toBe(false);
  });

  it("exposes all five BE-A03 roles", () => {
    expect(WORKSPACE_ROLES).toEqual(["admin", "engineer", "approver", "auditor", "viewer"]);
  });
});

describe("isWorkspaceRole", () => {
  it("accepts known roles and rejects anything else", () => {
    expect(isWorkspaceRole("admin")).toBe(true);
    expect(isWorkspaceRole("owner")).toBe(false);
    expect(isWorkspaceRole(null)).toBe(false);
    expect(isWorkspaceRole(7)).toBe(false);
  });
});
