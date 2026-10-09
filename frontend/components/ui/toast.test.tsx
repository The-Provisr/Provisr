import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toast } from "@/components/ui/toast";

describe("Toast", () => {
  it("renders a success status", () => {
    render(<Toast message="Policy settings saved." />);
    expect(screen.getByRole("status")).toHaveTextContent("Policy settings saved.");
  });

  it("renders an error alert", () => {
    render(<Toast message="Failed to save." tone="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to save.");
  });

  it("dismisses via the button", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved." onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(onDismiss).toHaveBeenCalled();
  });
});