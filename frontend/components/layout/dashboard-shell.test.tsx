import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

import { DashboardShell } from "./dashboard-shell";
import type { WorkspaceMembership } from "@/lib/orchestration/workspace-types";

const adminWorkspace: WorkspaceMembership = {
  id: "ws_admin",
  name: "Acme Platform",
  slug: "acme-platform",
  environment: "production",
  role: "admin",
};

const viewerWorkspace: WorkspaceMembership = {
  id: "ws_viewer",
  name: "Sandbox",
  slug: "sandbox",
  environment: "development",
  role: "viewer",
};

function mockList(payload: { workspaces: WorkspaceMembership[]; activeWorkspaceId: string | null }) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderShell() {
  return render(
    <DashboardShell clerkEnabled={false}>
      <div data-testid="shell-content">Content</div>
    </DashboardShell>,
  );
}

const NAV_TESTIDS = [
  "nav-chat",
  "nav-dashboard",
  "nav-cloud_accounts",
  "nav-team",
  "nav-policy",
  "nav-approvals",
  "nav-resources",
  "nav-audit",
  "nav-billing",
];

describe("DashboardShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders children inside the shell", () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();
    expect(screen.getByTestId("shell-content")).toBeInTheDocument();
  });

  it("shows every nav item for an admin", async () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();

    await waitFor(() => expect(screen.getByTestId("nav-team")).toBeInTheDocument());
    for (const testId of NAV_TESTIDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it("hides nav items the role cannot access", async () => {
    mockList({ workspaces: [viewerWorkspace], activeWorkspaceId: "ws_viewer" });
    renderShell();

    await waitFor(() => expect(screen.getByTestId("nav-chat")).toBeInTheDocument());

    expect(screen.getByTestId("nav-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-team")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-policy")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-approvals")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-resources")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-audit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-billing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-cloud_accounts")).not.toBeInTheDocument();
  });

  it("shows every nav item when the workspace list is degraded", async () => {
    mockList({ workspaces: [], activeWorkspaceId: null });
    renderShell();

    await waitFor(() => expect(screen.getByTestId("nav-team")).toBeInTheDocument());
  });

  it("shows the active workspace name and role badge", async () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();

    await waitFor(() =>
      expect(screen.getByTestId("workspace-switcher-name")).toHaveTextContent("Acme Platform"),
    );
    expect(screen.getByTestId("role-badge-admin")).toBeInTheDocument();
  });

  it("lists all workspaces in the switcher and re-filters nav on select", async () => {
    mockList({ workspaces: [adminWorkspace, viewerWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();

    await waitFor(() => expect(screen.getByTestId("nav-team")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
    const menu = screen.getByTestId("workspace-switcher-menu");
    expect(within(menu).getByTestId("workspace-option-sandbox")).toBeInTheDocument();

    fireEvent.click(within(menu).getByTestId("workspace-option-sandbox"));

    await waitFor(() =>
      expect(screen.getByTestId("workspace-switcher-name")).toHaveTextContent("Sandbox"),
    );
    expect(screen.queryByTestId("nav-team")).not.toBeInTheDocument();
  });

  it("collapses and expands the sidebar, persisting the choice", async () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();

    const sidebar = screen.getByTestId("dashboard-sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "false");

    fireEvent.click(screen.getByTestId("sidebar-collapse-toggle"));

    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem("provisr-sidebar-collapsed")).toBe("true");
  });

  it("opens the global search placeholder from the button and from Cmd+K", () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();

    expect(screen.queryByTestId("search-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("global-search"));
    expect(screen.getByTestId("search-panel")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("search-panel")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByTestId("search-panel")).toBeInTheDocument();
  });

  it("falls back to the static account card when Clerk is disabled", () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();
    expect(screen.getByTestId("account-card")).toBeInTheDocument();
  });
});
