import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ComputePlanComponent,
  computePlanFromResource,
  computePlanSchema,
} from "./compute_plan";
import type { ComputePlanData } from "./compute_plan";

vi.mock("next/image", () => ({
  default: () => <span data-testid="mock-provider-logo" />,
}));

function tileValue(label: string): string | null {
  const labelElement = screen.getByText(label);
  return labelElement.parentElement?.querySelector("p")?.textContent ?? null;
}

const fullData: ComputePlanData = computePlanSchema.parse({
  service: "api-server",
  provider: "aws",
  instanceType: "t3.medium",
  replicaCount: 2,
  autoScaling: { min: 1, max: 4, desired: 2 },
  os: "Ubuntu 22.04",
  architecture: "x86_64",
  vcpu: 2,
  memoryGb: 4,
  hourlyCostUsd: 0.0416,
  monthlyCostUsd: 30.37,
  reservation: "on-demand",
  policyNotes: ["Approved by cost guardrails"],
});

describe("ComputePlanComponent (full display)", () => {
  it("renders provider logo, service, and the instance/OS/architecture badges", () => {
    render(<ComputePlanComponent data={fullData} />);

    expect(screen.getByTestId("mock-provider-logo")).toBeInTheDocument();
    expect(screen.getByText("api-server")).toBeInTheDocument();
    expect(screen.getByText("t3.medium")).toBeInTheDocument();
    expect(screen.getByText("Ubuntu 22.04")).toBeInTheDocument();
    expect(screen.getByText("x86_64")).toBeInTheDocument();
    expect(screen.getByText("2 Replicas")).toBeInTheDocument();
  });

  it("renders the specifications table (vCPU, memory, hourly and monthly pricing)", () => {
    render(<ComputePlanComponent data={fullData} />);

    expect(tileValue("vCPU")).toBe("2");
    expect(tileValue("Memory")).toBe("4 GB");
    expect(tileValue("Hourly")).toBe("$0.0416/hr");
    expect(tileValue("Monthly")).toBe("$30.37/mo");
  });

  it("renders the sizing section with min/max/desired node counts", () => {
    render(<ComputePlanComponent data={fullData} />);

    expect(tileValue("Min Nodes")).toBe("1");
    expect(tileValue("Max Nodes")).toBe("4");
    expect(tileValue("Desired Nodes")).toBe("2");
  });

  it("falls back to a single nodes tile when auto-scaling data is absent", () => {
    const data = computePlanSchema.parse({ service: "worker" });

    render(<ComputePlanComponent data={data} />);

    expect(tileValue("Nodes")).toBe("1");
    expect(screen.queryByText("Min Nodes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-provider-logo")).not.toBeInTheDocument();
  });

  it("omits the specifications section when no spec or pricing fields exist", () => {
    const data = computePlanSchema.parse({ service: "bare" });

    render(<ComputePlanComponent data={data} />);

    expect(screen.queryByText("Specifications")).not.toBeInTheDocument();
  });
});

describe("ComputePlanComponent (policy notes strip)", () => {
  it("shows the unreserved warning and server-driven policy notes", () => {
    render(<ComputePlanComponent data={fullData} />);

    expect(
      screen.getByText(/Unreserved instance \(on-demand\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Approved by cost guardrails"),
    ).toBeInTheDocument();
  });

  it("shows the high-cost warning when the monthly estimate crosses the threshold", () => {
    const data = computePlanSchema.parse({
      service: "big-node",
      reservation: "reserved",
      monthlyCostUsd: 900,
    });

    render(<ComputePlanComponent data={data} />);

    expect(screen.getByText(/High-cost configuration/)).toBeInTheDocument();
    expect(tileValue("Monthly")).toBe("$900.00/mo");
    expect(screen.queryByText(/Unreserved/)).not.toBeInTheDocument();
  });

  it("renders no policy strip for reserved, low-cost configurations", () => {
    const data = computePlanSchema.parse({
      service: "tiny",
      reservation: "reserved",
      monthlyCostUsd: 12,
    });

    const { container } = render(<ComputePlanComponent data={data} />);

    expect(screen.queryByText(/Unreserved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/High-cost/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Approved by cost guardrails/)).not.toBeInTheDocument();
    expect(container.querySelector(".border-amber-200")).toBeNull();
  });
});

describe("ComputePlanComponent (states)", () => {
  it("renders a loading skeleton when state=loading", () => {
    render(<ComputePlanComponent data={fullData} state="loading" />);

    expect(screen.getByTestId("compute-plan-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("api-server")).not.toBeInTheDocument();
  });

  it("renders the loading skeleton when data is missing", () => {
    render(<ComputePlanComponent />);

    expect(screen.getByTestId("compute-plan-skeleton")).toBeInTheDocument();
  });

  it("renders the error fallback when state=error", () => {
    render(<ComputePlanComponent data={fullData} state="error" />);

    expect(screen.getByTestId("compute-plan-error")).toBeInTheDocument();
    expect(screen.getByText("Compute plan unavailable")).toBeInTheDocument();
    expect(screen.queryByText("api-server")).not.toBeInTheDocument();
  });

  it("surfaces a custom error message in the error fallback", () => {
    render(
      <ComputePlanComponent state="error" errorMessage="Pricing feed is offline." />,
    );

    expect(screen.getByText("Pricing feed is offline.")).toBeInTheDocument();
  });
});

describe("computePlanSchema", () => {
  it("coerces manifest string fields into numbers", () => {
    const data = computePlanSchema.parse({
      service: "api",
      vcpu: "2",
      memoryGb: "4",
      hourlyCostUsd: "0.0416",
      autoScaling: { min: "1", max: "3", desired: "2" },
    });

    expect(data.vcpu).toBe(2);
    expect(data.memoryGb).toBe(4);
    expect(data.hourlyCostUsd).toBe(0.0416);
    expect(data.autoScaling).toEqual({
      min: 1,
      max: 3,
      desired: 2,
      targetCpuUtilization: undefined,
    });
  });

  it("rejects fields with unparseable values", () => {
    expect(() => computePlanSchema.parse({ service: "api", vcpu: "abc" })).toThrow();
    expect(() =>
      computePlanSchema.parse({ service: "api", reservation: "pay-as-you-go" }),
    ).toThrow();
  });
});

describe("computePlanFromResource (manifest mapping)", () => {
  const resource = {
    name: "web",
    type: "aws_ec2",
    properties: {
      instance_type: "t3.medium",
      image: "ami-0123456789",
      count: "2",
      os: "Amazon Linux 2023",
      architecture: "x86_64",
      vcpu: "2",
      memory_gb: "4",
      hourly_cost_usd: "0.0416",
      min_nodes: "1",
      max_nodes: "4",
      desired_nodes: "2",
      reservation: "on-demand",
    },
  };

  it("maps manifest fields so they validate against the schema and render", () => {
    const mapped = computePlanFromResource(resource, "aws");
    const data = computePlanSchema.parse(mapped);

    render(<ComputePlanComponent data={data} />);

    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByTestId("mock-provider-logo")).toBeInTheDocument();
    expect(screen.getByText("t3.medium")).toBeInTheDocument();
    expect(screen.getByText("Amazon Linux 2023")).toBeInTheDocument();
    expect(screen.getByText("2 Replicas")).toBeInTheDocument();
    expect(tileValue("vCPU")).toBe("2");
    expect(tileValue("Memory")).toBe("4 GB");
    expect(tileValue("Hourly")).toBe("$0.0416/hr");
    expect(tileValue("Desired Nodes")).toBe("2");
    expect(screen.getByText(/Unreserved instance \(on-demand\)/)).toBeInTheDocument();
  });

  it("derives the monthly estimate from hourly pricing when monthly is absent", () => {
    const mapped = computePlanFromResource({
      name: "derive",
      properties: { hourly_cost_usd: "0.0416" },
    });
    const data = computePlanSchema.parse(mapped);

    expect(data.monthlyCostUsd).toBeCloseTo(30.368, 3);

    render(<ComputePlanComponent data={data} />);
    expect(tileValue("Monthly")).toBe("$30.37/mo");
  });

  it("drops unparseable numeric properties instead of failing validation", () => {
    const mapped = computePlanFromResource({
      name: "resilient",
      properties: { vcpu: "not-a-number", count: "3" },
    }) as { vcpu?: number; replicaCount?: number };

    expect(mapped.vcpu).toBeUndefined();
    expect(() => computePlanSchema.parse(mapped)).not.toThrow();
    expect(computePlanSchema.parse(mapped).replicaCount).toBe(3);
  });
});
