import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResourcesPage from "./page";

describe("ResourcesPage", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // Reset window.location.search before each test
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      search: "",
    } as any;
  });

  afterEach(() => {
    window.location = originalLocation;
    vi.restoreAllMocks();
  });

  it("renders default resources inventory successfully", async () => {
    render(<ResourcesPage />);

    // Initially loading
    expect(
      screen.getByLabelText("Loading resource dashboard")
    ).toBeInTheDocument();

    // After async load resolves with default mock data
    await waitFor(() => {
      expect(screen.getByText("Resource inventory")).toBeInTheDocument();
    });

    expect(screen.getByText("Total resources")).toBeInTheDocument();
    expect(screen.getByText("Search, filter, and sort the resources Provisr manages.")).toBeInTheDocument();
  });

  it("renders empty state when scenario is empty", async () => {
    window.location.search = "?scenario=empty";
    render(<ResourcesPage />);

    await waitFor(() => {
      expect(screen.getByText("No resources yet")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Resources appear here after a provisioning request completes.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /provision through chat/i })).toHaveAttribute("href", "/chat");
  });

  it("renders error state with retry button when scenario is error", async () => {
    window.location.search = "?scenario=error";
    render(<ResourcesPage />);

    await waitFor(() => {
      expect(screen.getByText("Could not load resources")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Failed to connect to cloud state provider. Please check your credentials and retry.")
    ).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(retryButton).toBeInTheDocument();

    // Switch scenario to default and click Retry
    window.location.search = "";
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText("Resource inventory")).toBeInTheDocument();
    });
  });
});
