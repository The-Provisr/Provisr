import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComingSoon } from "./coming-soon";

describe("ComingSoon", () => {
  it("renders the screen title and its delivery week", () => {
    render(<ComingSoon title="Workspace insights" week={10} />);

    expect(screen.getByTestId("coming-soon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workspace insights" })).toBeInTheDocument();
    expect(screen.getByText("Coming in Week 10")).toBeInTheDocument();
  });

  it("renders an optional description when provided", () => {
    render(<ComingSoon description="Charts and analytics land here." title="Insights" week="9" />);
    expect(screen.getByText("Charts and analytics land here.")).toBeInTheDocument();
  });
});
