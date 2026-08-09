import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArchitectureSummary } from "@/components/ui/architecture-summary";
import type { ArchitectureSummaryPayload } from "@/lib/architecture/types";

const payload: ArchitectureSummaryPayload = {
  provider: "aws",
  region: "us-east-1",
  environment: "production",
  resourceCount: 4,
  resources: [
    { type: "compute", count: 3 },
    { type: "database", count: 1 },
  ],
  assumptions: ["Managed by ECS with autoscaling", "RDS Postgres with daily backups"],
  unknowns: ["Public load balancer exposure"],
  warnings: ["Public load balancer requires workspace approval"],
};

describe("ArchitectureSummary", () => {
  it("renders provider logo, region, and environment badges", () => {
    const { container } = render(<ArchitectureSummary payload={payload} />);

    const logo = container.querySelector("img");
    expect(logo?.getAttribute("src")).toContain("aws");
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
  });

  it("renders resource count eyebrow and resource rows", () => {
    render(<ArchitectureSummary payload={payload} />);

    expect(screen.getByText("4 resources")).toBeInTheDocument();
    expect(screen.getByText("3x Compute")).toBeInTheDocument();
    expect(screen.getByText("1x Database")).toBeInTheDocument();
  });

  it("renders assumptions as an ordered list in order", () => {
    const { container } = render(<ArchitectureSummary payload={payload} />);

    const list = container.querySelector("ol");
    expect(list).not.toBeNull();
    const items = list?.querySelectorAll("li") ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Managed by ECS with autoscaling");
    expect(items[1]?.textContent).toContain("RDS Postgres with daily backups");
  });

  it("renders unknown resource types with a fallback icon without crashing", () => {
    const payloadWithUnknownType: ArchitectureSummaryPayload = {
      ...payload,
      resources: [{ type: "kubernetes_cluster", count: 2 }],
    };

    render(<ArchitectureSummary payload={payloadWithUnknownType} />);

    expect(screen.getByText("2x Kubernetes_cluster")).toBeInTheDocument();
  });

  it("shows a Clarify button per unknown and calls onClarify", () => {
    const onClarify = vi.fn();
    render(
      <ArchitectureSummary
        payload={{ ...payload, unknowns: ["Public load balancer exposure", "Secrets storage"] }}
        onClarify={onClarify}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Clarify" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(onClarify).toHaveBeenCalledTimes(1);
    expect(onClarify).toHaveBeenCalledWith("Public load balancer exposure");
  });

  it("hides Clarify buttons when onClarify is absent", () => {
    render(<ArchitectureSummary payload={payload} />);

    expect(screen.queryByRole("button", { name: "Clarify" })).toBeNull();
  });

  it("renders warnings as cards with text", () => {
    render(<ArchitectureSummary payload={payload} />);

    expect(
      screen.getByText("Public load balancer requires workspace approval"),
    ).toBeInTheDocument();
  });

  it("shows None identified per empty section", () => {
    const emptySections: ArchitectureSummaryPayload = {
      ...payload,
      resources: [],
      assumptions: [],
      unknowns: [],
      warnings: ["Public load balancer requires workspace approval"],
    };

    render(<ArchitectureSummary payload={emptySections} />);

    expect(screen.getAllByText("None identified")).toHaveLength(3);
  });

  it("renders a compact empty card when the whole payload is empty", () => {
    const emptyPayload: ArchitectureSummaryPayload = {
      provider: "aws",
      region: "us-east-1",
      environment: "production",
      resourceCount: 0,
      resources: [],
      assumptions: [],
      unknowns: [],
      warnings: [],
    };

    render(<ArchitectureSummary payload={emptyPayload} />);

    expect(screen.getByText("Architecture summary")).toBeInTheDocument();
    expect(screen.getAllByText("None identified")).toHaveLength(1);
  });

  it("renders a loading skeleton for state=loading and for missing payload", () => {
    const { rerender } = render(<ArchitectureSummary state="loading" />);
    expect(screen.getByTestId("architecture-summary-skeleton")).toBeInTheDocument();

    rerender(<ArchitectureSummary />);
    expect(screen.getByTestId("architecture-summary-skeleton")).toBeInTheDocument();
  });
});
