import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("defaults to the dark theme and marks it pressed", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByTestId("theme-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Dark theme")).toBeInTheDocument();
  });

  it("toggles to light and persists the choice", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByTestId("theme-toggle"));

    expect(screen.getByTestId("theme-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("provisr-theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("restores a persisted preference on mount", () => {
    window.localStorage.setItem("provisr-theme", "light");
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});
