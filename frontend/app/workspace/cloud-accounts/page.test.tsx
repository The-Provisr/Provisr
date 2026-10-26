import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CloudAccountsPage from "./page";

const client = vi.hoisted(() => ({
  listCloudAccounts: vi.fn(),
  listCapabilities: vi.fn(),
  createCloudAccount: vi.fn(),
  getCloudAccount: vi.fn(),
  verifyCloudAccount: vi.fn(),
  deleteCloudAccount: vi.fn(),
  isActiveRunsError: vi.fn(() => false),
  errorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : "Something went wrong.",
  ),
}));

vi.mock("@/lib/cloud-accounts/client", () => client);

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/cloud-accounts",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

const account = {
  id: "acc-1",
  workspace_id: "ws-1",
  provider: "aws",
  label: "Prod",
  status: "pending" as const,
  created_at: "",
  updated_at: "",
};

function setSearch(search: string) {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: unknown }).location = {
    ...window.location,
    search,
  };
}

describe("CloudAccountsPage", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_PROVISR_AWS_ACCOUNT_ID", "123456789012");
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      workspaces: [{ id: "ws-1", name: "Team", slug: "team", role: "admin", environment: "development" }],
      activeWorkspaceId: "ws-1", degraded: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    client.listCloudAccounts.mockResolvedValue([]);
    client.listCapabilities.mockResolvedValue({ workspace_id: "ws-1", accounts: [] });
    setSearch("");
  });

  afterEach(() => {
    (window as unknown as { location: unknown }).location = originalLocation;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows a loading state then the provider grid", async () => {
    render(<CloudAccountsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect account" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Cloud Accounts" })).toBeInTheDocument();
  });

  it("opens the AWS panel from the header action", async () => {
    render(<CloudAccountsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect AWS" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect AWS" }));
    expect(screen.getByLabelText("External ID")).toBeInTheDocument();
  });

  it("auto-opens the panel when arriving with ?connect=aws", async () => {
    setSearch("?connect=aws");
    render(<CloudAccountsPage />);
    await waitFor(() =>
      expect(screen.getByLabelText("External ID")).toBeInTheDocument(),
    );
  });

  it("creates then verifies and refreshes the grid", async () => {
    client.listCloudAccounts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...account, status: "active" }]);
    client.createCloudAccount.mockResolvedValue(account);
    client.verifyCloudAccount.mockResolvedValue({ ...account, status: "active" });

    render(<CloudAccountsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect AWS" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect AWS" }));

    fireEvent.change(screen.getByLabelText("Role ARN"), {
      target: { value: "arn:aws:iam::123456789012:role/ProvisrExecutionRole" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify connection" }));

    await waitFor(() => expect(client.createCloudAccount).toHaveBeenCalledTimes(1));
    expect(client.createCloudAccount.mock.calls[0]?.[0]).toMatchObject({
      provider: "aws",
      metadata: { role_arn: "arn:aws:iam::123456789012:role/ProvisrExecutionRole" },
    });
    await waitFor(() => expect(client.verifyCloudAccount).toHaveBeenCalledWith("acc-1", expect.any(String)));
    expect(await screen.findByText("AWS account verified and connected.")).toBeInTheDocument();
  });

  it("shows an inline error when verification fails and allows retry", async () => {
    client.listCloudAccounts.mockResolvedValue([account]);
    client.verifyCloudAccount.mockRejectedValue(new Error("External ID mismatch"));

    render(<CloudAccountsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Verify connection" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Verify connection" }));
    expect(screen.getByLabelText("Original external ID")).toHaveValue("");
    expect(screen.queryByLabelText("Role ARN")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Original external ID"), { target: { value: "original-stack-external-id" } });
    // The first "Verify connection" is the card action; the panel's is last.
    const verifyButtons = screen.getAllByRole("button", { name: "Verify connection" });
    fireEvent.click(verifyButtons[verifyButtons.length - 1]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("External ID mismatch");
    expect(client.createCloudAccount).not.toHaveBeenCalled();
    expect(client.verifyCloudAccount).toHaveBeenCalledWith("acc-1", "original-stack-external-id");
  });

  it.each(["", "?connect=aws"])("opens an existing account with an empty original external ID from %j", async (search) => {
    client.listCloudAccounts.mockResolvedValue([account]);
    setSearch(search);
    render(<CloudAccountsPage />);
    if (!search) {
      await waitFor(() => expect(screen.getByRole("button", { name: "Connect AWS" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Connect AWS" }));
    }
    expect(await screen.findByLabelText("Original external ID")).toHaveValue("");
    expect(screen.queryByLabelText("Role ARN")).not.toBeInTheDocument();
    expect(client.createCloudAccount).not.toHaveBeenCalled();
  });

  it("retains a newly created account and retries verification without creating a duplicate", async () => {
    client.createCloudAccount.mockResolvedValue(account);
    client.verifyCloudAccount.mockRejectedValueOnce(new Error("Temporary verification failure"));
    client.verifyCloudAccount.mockResolvedValueOnce({ ...account, status: "active" });
    render(<CloudAccountsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect AWS" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Connect AWS" }));
    fireEvent.change(screen.getByLabelText("Role ARN"), {
      target: { value: "arn:aws:iam::123456789012:role/ProvisrExecutionRole" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary verification failure");
    const originalExternalId = client.verifyCloudAccount.mock.calls[0]![1];
    expect(screen.getByLabelText("Original external ID")).toHaveValue(originalExternalId);
    const verifyButtons = screen.getAllByRole("button", { name: "Verify connection" });
    fireEvent.click(verifyButtons[verifyButtons.length - 1]!);
    expect(await screen.findByText("AWS account verified and connected.")).toBeInTheDocument();
    expect(client.createCloudAccount).toHaveBeenCalledTimes(1);
    expect(client.verifyCloudAccount.mock.calls).toEqual([["acc-1", originalExternalId], ["acc-1", originalExternalId]]);
  });

  it.each([new Error("Capabilities unavailable"), { workspace_id: "", accounts: [] }])("shows a retryable capability error without mounting the connect panel: %j", async (result) => {
    setSearch("?connect=aws");
    if (result instanceof Error) client.listCapabilities.mockRejectedValueOnce(result);
    else client.listCapabilities.mockResolvedValueOnce(result);
    render(<CloudAccountsPage />);
    expect(await screen.findByText("Could not load cloud accounts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect AWS" })).toBeDisabled();
    expect(screen.queryByLabelText("External ID")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("External ID")).toBeInTheDocument();
  });

  it("renders a retryable error banner when loading fails", async () => {
    client.listCloudAccounts.mockRejectedValue(new Error("network down"));
    render(<CloudAccountsPage />);
    await waitFor(() =>
      expect(screen.getByText("Could not load cloud accounts")).toBeInTheDocument(),
    );
    expect(screen.getByText("network down")).toBeInTheDocument();
    client.listCloudAccounts.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect account" })).toBeInTheDocument(),
    );
  });
});
