import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PolicyPackCard } from "@/components/ui/policy-pack-card";
import { policyPacks } from "@/lib/policy/mock-data";

const pack = policyPacks[0]!;

describe("PolicyPackCard", () => {
  it("renders name, version, description, and rule count", () => {
    render(<PolicyPackCard pack={pack} />);
    expect(screen.getByText("Secure Baseline")).toBeInTheDocument();
    expect(screen.getByText("v2.4.1")).toBeInTheDocument();
    expect(screen.getByText(/Core security posture requirements/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("marks the selected pack", () => {
    render(<PolicyPackCard pack={pack} selected />);
    expect(screen.getByTestId("policy-pack-card")).toHaveAttribute("aria-selected", "true");
  });

  it("selects on card click", () => {
    const onSelect = vi.fn();
    render(<PolicyPackCard pack={pack} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("policy-pack-card"));
    expect(onSelect).toHaveBeenCalledWith("secure-baseline");
  });

  it("toggles the pack without selecting it", () => {
    const onEnabledChange = vi.fn();
    const onSelect = vi.fn();
    render(<PolicyPackCard pack={pack} onEnabledChange={onEnabledChange} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle pack Secure Baseline" }));
    expect(onEnabledChange).toHaveBeenCalledWith("secure-baseline", false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects via the Configure button", () => {
    const onSelect = vi.fn();
    render(<PolicyPackCard pack={pack} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Configure/ }));
    expect(onSelect).toHaveBeenCalledWith("secure-baseline");
  });
});