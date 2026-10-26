import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/dashboard",
}));

import { WorkspaceSidebar } from "@/components/ui/provisr-app";
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

function renderShell(sidebar?: ReactNode) {
  return render(
    <DashboardShell clerkEnabled={false} sidebar={sidebar}>
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
    navigation.push.mockReset();
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

  it("keeps restricted links hidden during loading and after degraded listing; retry recovers", async () => {
    const fetchMock = mockList({ workspaces: [], activeWorkspaceId: null });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ degraded: true }) } as never);
    renderShell();
    expect(screen.queryByTestId("nav-team")).not.toBeInTheDocument();
    await screen.findByRole("alert");
    expect(screen.queryByTestId("nav-team")).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" }) });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("nav-team");
  });

  it("removes restricted links from the real legacy workspace sidebar", async () => {
    mockList({ workspaces: [{ ...viewerWorkspace, role: "engineer" }], activeWorkspaceId: "ws_viewer" });
    renderShell(<WorkspaceSidebar active="Cloud Accounts" />);
    await screen.findByTestId("nav-cloud_accounts");
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Policies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Billing/ })).not.toBeInTheDocument();
  });

  it("does not present a fallback workspace or role for a stale active claim", async () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "stale" });
    renderShell();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByTestId("workspace-switcher-name")).toHaveTextContent("No workspace");
    expect(screen.queryByTestId("role-badge-admin")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-team")).not.toBeInTheDocument();
  });

  it("shows the active workspace name and role badge", async () => {
    mockList({ workspaces: [adminWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();

    await waitFor(() =>
      expect(screen.getByTestId("workspace-switcher-name")).toHaveTextContent("Acme Platform"),
    );
    expect(screen.getByTestId("role-badge-admin")).toBeInTheDocument();
  });

  it("persists selection before navigating to the token-refresh handoff", async () => {
    const fetchMock = mockList({ workspaces: [adminWorkspace, viewerWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();
    await screen.findByTestId("nav-team");
    let complete!: (value: never) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
    fireEvent.click(screen.getByTestId("workspace-option-sandbox"));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workspace/claim", expect.objectContaining({ method: "POST", body: JSON.stringify({ workspaceId: "ws_viewer" }) }));
    expect(screen.getByTestId("workspace-switcher-name")).toHaveTextContent("Acme Platform");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-switcher-trigger")).toBeDisabled();
    complete({ ok: true, json: async () => ({ workspaceId: "ws_viewer" }) } as never);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/post-auth"));
  });

  it.each(["rejected", "mismatch"])("keeps current workspace after %s selection and allows retry", async (mode) => {
    const fetchMock = mockList({ workspaces: [adminWorkspace, viewerWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();
    await screen.findByTestId("nav-team");
    fetchMock.mockResolvedValueOnce({ ok: mode !== "rejected", status: 403, json: async () => ({ workspaceId: "wrong" }) } as never);
    fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
    fireEvent.click(screen.getByTestId("workspace-option-sandbox"));
    await screen.findByRole("alert");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-switcher-name")).toHaveTextContent("Acme Platform");
    expect(screen.getByTestId("workspace-switcher-trigger")).not.toBeDisabled();
  });

  it("opens workspace options while collapsed", async () => {
    mockList({ workspaces: [adminWorkspace, viewerWorkspace], activeWorkspaceId: "ws_admin" });
    renderShell();
    await screen.findByTestId("nav-team");
    fireEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
    expect(within(screen.getByTestId("workspace-switcher-menu")).getByTestId("workspace-option-sandbox")).toBeInTheDocument();
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
