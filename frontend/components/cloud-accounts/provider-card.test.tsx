import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderCard } from "./provider-card";
import type { CloudAccount } from "@/lib/cloud-accounts/types";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

function account(status: CloudAccount["status"]): CloudAccount {
  return {
    id: "a1",
    workspace_id: "ws",
    provider: "aws",
    label: "Prod",
    status,
    created_at: "",
    updated_at: "",
  };
}

const noop = () => {};

function renderCard(overrides: Partial<Parameters<typeof ProviderCard>[0]> = {}) {
  return render(
    <ProviderCard
      account={undefined}
      busy={false}
      capability={undefined}
      onConnect={noop}
      onDelete={noop}
      onVerify={noop}
      provider="aws"
      {...overrides}
    />,
  );
}

describe("ProviderCard", () => {
  it("offers Connect for a not-connected connectable provider", () => {
    const onConnect = vi.fn();
    renderCard({ onConnect });
    const button = screen.getByRole("button", { name: "Connect account" });
    fireEvent.click(button);
    expect(onConnect).toHaveBeenCalledWith("aws");
  });

  it("disables Connect for providers that are not yet supported", () => {
    renderCard({ provider: "azure" });
    expect(screen.getByRole("button", { name: "Coming soon" })).toBeDisabled();
  });

  it("shows the pending state with a Verify action", () => {
    const onVerify = vi.fn();
    renderCard({ account: account("pending"), onVerify });
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify connection" }));
    expect(onVerify).toHaveBeenCalledWith(account("pending"));
  });

  it("labels a failed account's action as retry", () => {
    renderCard({ account: account("failed") });
    expect(screen.getByRole("button", { name: "Retry verification" })).toBeInTheDocument();
  });

  it("masks the account id and shows capability detail when active", () => {
    renderCard({
      account: account("active"),
      capability: {
        id: "a1",
        provider: "aws",
        status: "active",
        account_alias: "Prod",
        account_identity: "123456789012",
        default_region: "us-east-1",
        available_regions: ["us-east-1"],
        supported_domains: ["database", "storage"],
        execution_ready: true,
        checked_at: null,
      },
    });
    expect(screen.getByText("********9012")).toBeInTheDocument();
    expect(screen.queryByText("123456789012")).not.toBeInTheDocument();
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText("database, storage")).toBeInTheDocument();
    expect(screen.getByText("Execution ready")).toBeInTheDocument();
    // Active cards have no verify action.
    expect(screen.queryByRole("button", { name: "Verify connection" })).not.toBeInTheDocument();
  });

  it("flags a not-ready active account as unverified permissions", () => {
    renderCard({
      account: account("active"),
      capability: {
        id: "a1",
        provider: "aws",
        status: "active",
        account_alias: "Prod",
        account_identity: "123456789012",
        default_region: "us-east-1",
        available_regions: [],
        supported_domains: [],
        execution_ready: false,
        checked_at: null,
        warning: "Missing policy",
      },
    });
    expect(screen.getByText("Permissions not verified")).toBeInTheDocument();
    expect(screen.getByText("Missing policy")).toBeInTheDocument();
  });
});
