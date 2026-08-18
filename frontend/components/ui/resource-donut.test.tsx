import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResourceDonut } from "./resource-donut";

describe("ResourceDonut", () => {
  it("renders the count and label", () => {
    render(<ResourceDonut color="#FF9900" label="AWS" value={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("AWS")).toBeInTheDocument();
  });

  it("renders a ring for each provider color", () => {
    const { container } = render(
      <ResourceDonut color="#007FFF" label="Azure" value={2} />,
    );
    const rings = container.querySelectorAll("circle");
    expect(rings).toHaveLength(2);
    expect(rings[1]).toHaveAttribute("stroke", "#007FFF");
  });
});