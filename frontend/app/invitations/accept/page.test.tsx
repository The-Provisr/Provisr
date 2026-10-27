import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamError } from "@/lib/team/types";
import AcceptInvitationPage from "./page";

const client = vi.hoisted(() => ({
  lookupInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());

vi.mock("@/lib/team/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team/client")>()),
  ...client,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { firstName: "Bo", lastName: "Lee", primaryEmailAddress: { emailAddress: "bo@other.dev" } },
  }),
  useClerk: () => ({ signOut }),
}));

const invitation = {
  id: "inv1",
  workspace_id: "ws-9",
  email: "bo@acme.dev",
  role: "engineer",
  code: "code-123",
  created_at: "2026-10-20T00:00:00Z",
  expires_at: "2026-10-27T00:00:00Z",
};

function setSearch(search: string) {
  window.history.replaceState(null, "", `/invitations/accept${search}`);
}

describe("AcceptInvitationPage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ workspaceId: "ws-9" }), { status: 200 }));
    client.lookupInvitation.mockResolvedValue(invitation);
    setSearch("?code=code-123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("looks up by code, accepts, claims the workspace and hands off", async () => {
    client.acceptInvitation.mockResolvedValue({ id: "u9", role: "engineer" });
    render(<AcceptInvitationPage />);

    expect(await screen.findByTestId("role-badge-engineer")).toBeInTheDocument();
    expect(client.lookupInvitation).toHaveBeenCalledWith("code-123");
    expect(screen.getByLabelText("Your name")).toHaveValue("Bo Lee");

    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/post-auth"));
    expect(client.acceptInvitation).toHaveBeenCalledWith("code-123", "Bo Lee");
    expect(fetchMock).toHaveBeenCalledWith("/api/workspace/claim", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws-9" }),
    }));
  });

  it("explains an email mismatch and offers to switch accounts", async () => {
    client.acceptInvitation.mockRejectedValue(
      new TeamError("invitation is for a different email", 403, "email_mismatch"),
    );
    render(<AcceptInvitationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("sent to bo@acme.dev");
    expect(alert).toHaveTextContent("signed in as bo@other.dev");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with a different account" }));
    expect(signOut).toHaveBeenCalled();
  });

  it("shows expired invitations without an accept button", async () => {
    client.lookupInvitation.mockRejectedValue(new TeamError("invitation has expired", 410, "expired"));
    render(<AcceptInvitationPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/);
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("asks for a code when the link has none", async () => {
    setSearch("");
    render(<AcceptInvitationPage />);
    fireEvent.change(await screen.findByLabelText("Invitation code"), { target: { value: "manual" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up invitation" }));
    await waitFor(() => expect(client.lookupInvitation).toHaveBeenCalledWith("manual"));
  });
});
