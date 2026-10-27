import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamError } from "@/lib/team/types";
import TeamPage from "./page";

const client = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listInvitations: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

const roleState = vi.hoisted(() => ({ current: { status: "ready", role: "admin" } as unknown }));

vi.mock("@/lib/team/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team/client")>()),
  ...client,
}));

vi.mock("@/lib/team/use-workspace-role", () => ({
  useWorkspaceRole: () => roleState.current,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/team",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

const admin = { id: "u1", name: "Maya Chen", email: "maya@acme.dev", role: "admin", joined_at: "2026-10-01T00:00:00Z" };
const engineer = { id: "u2", name: "Owen Patel", email: "owen@acme.dev", role: "engineer", joined_at: "2026-10-02T00:00:00Z" };
const invitation = {
  id: "inv1",
  workspace_id: "ws-1",
  email: "sam@acme.dev",
  role: "approver",
  code: "code-123",
  created_at: "2026-10-20T00:00:00Z",
  expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
};

describe("TeamPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleState.current = { status: "ready", role: "admin" };
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      workspaces: [{ id: "ws-1", name: "Team", slug: "team", role: "admin", environment: "development" }],
      activeWorkspaceId: "ws-1", degraded: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    client.listMembers.mockResolvedValue([admin, engineer]);
    client.listInvitations.mockResolvedValue([invitation]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows members with role badges and pending invitations for admins", async () => {
    render(<TeamPage />);
    expect(await screen.findByText("Maya Chen")).toBeInTheDocument();
    expect(screen.getByText("owen@acme.dev")).toBeInTheDocument();
    expect(screen.getAllByTestId("role-badge-admin").length).toBeGreaterThan(0);
    expect(screen.getByText("sam@acme.dev")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change role for owen@acme.dev" })).toBeInTheDocument();
  });

  it("hides admin-only actions and data from non-admins", async () => {
    roleState.current = { status: "ready", role: "viewer" };
    render(<TeamPage />);
    expect(await screen.findByText("Admins only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Change role/ })).not.toBeInTheDocument();
    expect(client.listMembers).not.toHaveBeenCalled();
  });

  it("surfaces the last-admin guard when changing role", async () => {
    client.changeMemberRole.mockRejectedValue(
      new TeamError("cannot change role of the last admin", 409, "last_admin"),
    );
    render(<TeamPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Change role for maya@acme.dev" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New role"), { target: { value: "viewer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save role" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/at least one admin/);
    expect(client.changeMemberRole).toHaveBeenCalledWith("u1", "viewer");
  });

  it("surfaces the active-runs block when removing a member", async () => {
    client.removeMember.mockRejectedValue(
      new TeamError("cannot remove member with active provisioning runs", 409, "active_runs_exist"),
    );
    render(<TeamPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove owen@acme.dev" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove member" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/active provisioning runs/);
    expect(client.removeMember).toHaveBeenCalledWith("u2");
  });

  it("invites by email with a role and shows the share link", async () => {
    client.createInvitation.mockResolvedValue({ ...invitation, id: "inv2", email: "new@acme.dev", role: "engineer", code: "new-code" });
    render(<TeamPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Invite member" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Invitations expire after 7 days.");
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "new@acme.dev" } });
    fireEvent.change(within(dialog).getByLabelText("Invite role"), { target: { value: "engineer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create invitation" }));

    const link = await within(dialog).findByLabelText("Invitation link");
    expect((link as HTMLInputElement).value).toMatch(/\/invitations\/accept\?code=new-code$/);
    expect(client.createInvitation).toHaveBeenCalledWith("new@acme.dev", "engineer");
  });

  it("revokes a pending invitation after confirmation", async () => {
    client.revokeInvitation.mockResolvedValue(undefined);
    render(<TeamPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke invitation for sam@acme.dev" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke invitation" }));

    await waitFor(() => expect(client.revokeInvitation).toHaveBeenCalledWith("inv1"));
    expect(await screen.findByTestId("toast")).toHaveTextContent("Invitation for sam@acme.dev revoked.");
  });
});
