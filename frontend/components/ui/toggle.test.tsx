import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "@/components/ui/toggle";

describe("Toggle", () => {
  it("renders a switch with the checked state", () => {
    render(<Toggle checked label="Enable rule" onChange={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "Enable rule" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the inverted value", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not toggle when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked disabled onChange={onChange} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("activates via keyboard and fires onChange once through the native click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch");
    toggle.focus();
    fireEvent.keyDown(toggle, { key: " " });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});