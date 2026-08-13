import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResourceDriftBanner } from "./resource-drift-banner";

describe("ResourceDriftBanner", () => {
  it("renders the in-sync state when there is no drift", () => {
    render(<ResourceDriftBanner driftCount={0} />);
    expect(screen.getByText("All resources in sync")).toBeInTheDocument();
    expect(
      screen.getByText("Last state sync completed without drift."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the drift state with a singular resource count", () => {
    render(<ResourceDriftBanner driftCount={1} />);
    expect(screen.getByText("Configuration drift detected")).toBeInTheDocument();
    expect(
      screen.getByText("1 resource out of sync with the last planned state."),
    ).toBeInTheDocument();
  });

  it("pluralizes the drift count", () => {
    render(<ResourceDriftBanner driftCount={4} />);
    expect(
      screen.getByText("4 resources out of sync with the last planned state."),
    ).toBeInTheDocument();
  });

  it("shows the drift report action only when a handler is provided", () => {
    const onViewDriftReport = vi.fn();
    render(
      <ResourceDriftBanner driftCount={2} onViewDriftReport={onViewDriftReport} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View drift report" }));
    expect(onViewDriftReport).toHaveBeenCalledTimes(1);
  });

  it("omits the action when drifting without a handler", () => {
    render(<ResourceDriftBanner driftCount={2} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});