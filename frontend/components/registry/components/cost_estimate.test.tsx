import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CostEstimateComponent,
  costEstimateSchema,
} from "./cost_estimate";

const canonicalEstimate = {
  total_monthly_estimate: 500,
  currency: "USD",
  breakdown_by_service: [
    { service: "Compute", monthly_cost: 300, percentage: 60 },
    { service: "Database", monthly_cost: 200, percentage: 40 },
  ],
  assumptions: ["730 hours per month", "<img src=x onerror=alert(1) />"],
  confidence: "high" as const,
  pricing_source: "AWS Pricing API",
  freshness_note: "Updated 2 hours ago",
  cost_approval_threshold: 400,
  requires_approval: true,
};

describe("CostEstimateComponent", () => {
  it("normalizes and renders the canonical payload with proportions and metadata", () => {
    const data = costEstimateSchema.parse(canonicalEstimate);
    render(<CostEstimateComponent data={data} />);

    expect(screen.getByText(new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(500))).toBeInTheDocument();
    expect(screen.getByText("Compute")).toBeInTheDocument();
    expect(screen.getByText("730 hours per month")).toBeInTheDocument();
    expect(screen.getByText("high")).toHaveClass("bg-green-100");
    expect(screen.getByText("AWS Pricing API")).toBeInTheDocument();
    expect(screen.getByText("Updated 2 hours ago")).toBeInTheDocument();
    expect(screen.getByText(/Approval threshold:/)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();

    const computeBar = screen.getByRole("img", { name: /Compute:.*60.0 percent/i });
    expect(computeBar.firstElementChild).toHaveStyle({ width: "60%" });
  });

  it("renders medium and low confidence with the required colors", () => {
    const medium = costEstimateSchema.parse({ ...canonicalEstimate, confidence: "medium", requires_approval: false });
    const { rerender } = render(<CostEstimateComponent data={medium} />);
    expect(screen.getByText("medium")).toHaveClass("bg-amber-100");

    const low = costEstimateSchema.parse({ ...canonicalEstimate, confidence: "low", requires_approval: false });
    rerender(<CostEstimateComponent data={low} />);
    expect(screen.getByText("low")).toHaveClass("bg-red-100");
    expect(screen.queryByText(/Approval required/)).not.toBeInTheDocument();
  });

  it("keeps legacy payloads renderable and derives service percentages", () => {
    const data = costEstimateSchema.parse({
      currency: "USD",
      monthlyTotalUsd: 250,
      breakdown: [
        { category: "Compute", serviceName: "EC2", costUsd: 100 },
        { category: "Database", serviceName: "RDS", costUsd: 150 },
      ],
      deltaPercentage: 10,
    });
    render(<CostEstimateComponent data={data} />);

    expect(screen.getByText("EC2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /EC2:.*40.0 percent/i })).toBeInTheDocument();
    expect(screen.getByText("Not provided")).toBeInTheDocument();
    expect(screen.getByText("+10% vs current estimate")).toBeInTheDocument();
  });

  it("renders loading without showing a fabricated total", () => {
    const data = costEstimateSchema.parse({ state: "loading" });
    render(<CostEstimateComponent data={data} />);
    expect(screen.getByText("Estimating...")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cost estimate" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("renders partial estimates without replacing missing values with zero", () => {
    const data = costEstimateSchema.parse({
      state: "partial",
      currency: "EUR",
      breakdown_by_service: [{ service: "Compute", monthly_cost: 75, percentage: 100 }],
      partial_reasons: ["Database pricing is unavailable."],
      confidence: "low",
    });
    render(<CostEstimateComponent data={data} />);
    expect(screen.getByText("Partial estimate")).toBeInTheDocument();
    expect(screen.getByText("Total not available")).toBeInTheDocument();
    expect(screen.getByText("Database pricing is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText(/€0\.00/)).not.toBeInTheDocument();
  });

  it("uses a zero-safe empty breakdown and approval callout without a threshold", () => {
    const data = costEstimateSchema.parse({
      total_monthly_estimate: 0,
      currency: "USD",
      breakdown_by_service: [],
      requires_approval: true,
    });
    render(<CostEstimateComponent data={data} />);
    expect(screen.getByText("No service breakdown is available.")).toBeInTheDocument();
    expect(screen.getByText("Approval required for this estimate")).toBeInTheDocument();
    expect(screen.queryByText(/Approval threshold:/)).not.toBeInTheDocument();
  });

  it("rejects unsafe amounts, percentages, currencies, and missing default totals", () => {
    expect(costEstimateSchema.safeParse({ ...canonicalEstimate, total_monthly_estimate: -1 }).success).toBe(false);
    expect(costEstimateSchema.safeParse({ ...canonicalEstimate, breakdown_by_service: [{ service: "Compute", monthly_cost: 1, percentage: 101 }] }).success).toBe(false);
    expect(costEstimateSchema.safeParse({ ...canonicalEstimate, currency: "US dollars" }).success).toBe(false);
    expect(costEstimateSchema.safeParse({ breakdown_by_service: [] }).success).toBe(false);
  });

  it("preserves legacy unit prices without claiming a monthly share", () => {
    const data = costEstimateSchema.parse({
      monthlyTotalUsd: 87.6,
      breakdown: [{ category: "Compute", serviceName: "EC2 rate", costUsd: 0.12, unit: "hour" }],
    });
    render(<CostEstimateComponent data={data} />);
    expect(screen.getByText(/\/hour/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /EC2 rate/ })).not.toBeInTheDocument();
    expect(data.services[0]?.percentage).toBeUndefined();
  });

  it("uses the supplied share when a partial estimate has no total", () => {
    const data = costEstimateSchema.parse({
      state: "partial",
      breakdown_by_service: [{ service: "Compute", monthly_cost: 75, percentage: 25 }],
    });
    render(<CostEstimateComponent data={data} />);
    const bar = screen.getByRole("img", { name: /Compute:.*25.0 percent/ });
    expect(bar.firstElementChild).toHaveStyle({ width: "25%" });
    expect(screen.getByText("Total not available")).toBeInTheDocument();
  });

  it("does not invent percentages for legacy partial data without a total", () => {
    const data = costEstimateSchema.parse({
      state: "partial",
      breakdown: [{ category: "Compute", serviceName: "EC2", costUsd: 75 }],
    });
    render(<CostEstimateComponent data={data} />);
    expect(data.services[0]?.percentage).toBeUndefined();
    expect(screen.queryByRole("img", { name: /EC2/ })).not.toBeInTheDocument();
    expect(screen.getByText("Total not available")).toBeInTheDocument();
  });

  it("retains the supplied currency's standard fractional precision", () => {
    const data = costEstimateSchema.parse({ total_monthly_estimate: 1.234, currency: "BHD" });
    render(<CostEstimateComponent data={data} />);
    expect(screen.getByRole("region", { name: "Cost estimate" }).querySelector("strong")?.textContent).toBe(
      new Intl.NumberFormat(undefined, { style: "currency", currency: "BHD" }).format(1.234),
    );
  });

  it("keeps zero-total bars finite and zero width", () => {
    const data = costEstimateSchema.parse({
      total_monthly_estimate: 0,
      breakdown_by_service: [{ service: "Free tier", monthly_cost: 0, percentage: 0 }],
    });
    render(<CostEstimateComponent data={data} />);
    expect(screen.getByRole("img", { name: /Free tier/ }).firstElementChild).toHaveStyle({ width: "0%" });
  });
});
