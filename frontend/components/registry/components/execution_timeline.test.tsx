import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistryProvider } from "../RegistryProvider";
import { RegistryRenderer } from "../RegistryRenderer";
import {
  ExecutionTimelineComponent,
  executionTimelineSchema,
  type ExecutionTimelineData,
} from "./execution_timeline";

const baseData: ExecutionTimelineData = {
  currentStep: "Plan created",
  runId: "run-1",
  steps: [
    { id: "received", name: "Request received", description: "Run accepted.", status: "succeeded", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:05Z", durationMs: 5000 },
    { id: "policy_requirements", name: "Policy requirements", status: "succeeded", startedAt: "2026-01-01T00:00:05Z", completedAt: "2026-01-01T00:00:09Z", durationMs: 4000 },
    { id: "clarification", name: "Clarification", status: "skipped" },
    { id: "manifest", name: "Manifest drafted", status: "succeeded", durationMs: 2000 },
    { id: "plan", name: "Plan created", description: "Terraform plan produced for review.", status: "running", startedAt: "2026-01-01T00:00:11Z" },
    { id: "policy_check", name: "Policy check", status: "pending" },
    { id: "completed", name: "Completed", status: "pending" },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExecutionTimelineComponent", () => {
  it("renders every step with a text status label", () => {
    render(<ExecutionTimelineComponent data={baseData} />);
    expect(screen.getByText("Current:")).toBeInTheDocument();
    // In the header and as the running step name.
    expect(screen.getAllByText("Plan created").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBe(2);
  });

  it("marks the running step with aria-current", () => {
    render(<ExecutionTimelineComponent data={baseData} />);
    const current = screen
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("aria-current") === "step");
    expect(current).toBeDefined();
    expect(current).toHaveTextContent("Plan created");
  });

  it("renders timestamps and durations", () => {
    render(<ExecutionTimelineComponent data={baseData} />);
    expect(screen.getByText("Started 00:00:00")).toBeInTheDocument();
    expect(screen.getByText("Finished 00:00:05")).toBeInTheDocument();
    expect(screen.getByText("5.0s")).toBeInTheDocument();
    expect(screen.getByText("4.0s")).toBeInTheDocument();
  });

  it("renders artifact chips and links", () => {
    render(
      <ExecutionTimelineComponent
        data={{
          currentStep: "Manifest drafted",
          steps: [
            {
              id: "manifest",
              name: "Manifest drafted",
              status: "running",
              artifacts: [
                { id: "manifest-v2", title: "Manifest v2", type: "manifest" },
                { id: "plan-1", title: "Terraform plan", type: "plan", url: "/artifacts/plan-1" },
              ],
            },
          ],
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "Terraform plan" });
    expect(link).toHaveAttribute("href", "/artifacts/plan-1");
    expect(screen.getByText("Manifest v2")).toBeInTheDocument();
  });

  it("announces the current step politely", () => {
    render(<ExecutionTimelineComponent data={baseData} />);
    expect(screen.getByText("Plan created is running.")).toHaveAttribute("aria-live", "polite");
  });

  it("shows terminal headlines for failed and cancelled runs", () => {
    const { rerender } = render(
      <ExecutionTimelineComponent
        data={{
          currentStep: "Cloud context",
          steps: [
            { id: "received", name: "Request received", status: "succeeded" },
            { id: "cloud_context", name: "Cloud context", status: "failed" },
            { id: "manifest", name: "Manifest drafted", status: "pending" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Run failed")).toBeInTheDocument();
    expect(screen.getByText("Cloud context: Failed.")).toBeInTheDocument();

    rerender(
      <ExecutionTimelineComponent
        data={{
          currentStep: "Policy requirements",
          steps: [
            { id: "received", name: "Request received", status: "succeeded" },
            { id: "policy_requirements", name: "Policy requirements", status: "cancelled" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Run cancelled")).toBeInTheDocument();
  });

  it("shows the completed headline when every step settled", () => {
    render(
      <ExecutionTimelineComponent
        data={{
          currentStep: "Completed",
          steps: [
            { id: "received", name: "Request received", status: "succeeded" },
            { id: "clarification", name: "Clarification", status: "skipped" },
            { id: "completed", name: "Completed", status: "succeeded" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Run completed")).toBeInTheDocument();
  });

  it("auto-follows the running step as it progresses", () => {
    const scrollIntoView = vi.fn();
    const prototype = Object.getPrototypeOf(document.createElement("li"));
    const original = prototype.scrollIntoView;
    prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender } = render(<ExecutionTimelineComponent data={baseData} />);
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
        behavior: "smooth",
      });

      scrollIntoView.mockClear();
      rerender(
        <ExecutionTimelineComponent
          data={{
            ...baseData,
            currentStep: "Policy check",
            steps: baseData.steps.map((step) =>
              step.id === "plan"
                ? { ...step, status: "succeeded" }
                : step.id === "policy_check"
                  ? { ...step, status: "running" }
                  : step,
            ),
          }}
        />,
      );
      // Called again for the new running step.
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      if (original) prototype.scrollIntoView = original;
      else delete prototype.scrollIntoView;
    }
  });

  it("does not scroll when autoFollow is disabled", () => {
    const scrollIntoView = vi.fn();
    const prototype = Object.getPrototypeOf(document.createElement("li"));
    const original = prototype.scrollIntoView;
    prototype.scrollIntoView = scrollIntoView;
    try {
      render(<ExecutionTimelineComponent autoFollow={false} data={baseData} />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (original) prototype.scrollIntoView = original;
      else delete prototype.scrollIntoView;
    }
  });

  it("tolerates a missing scrollIntoView (jsdom default)", () => {
    const prototype = Object.getPrototypeOf(document.createElement("li"));
    const original = prototype.scrollIntoView;
    delete prototype.scrollIntoView;
    try {
      expect(() => render(<ExecutionTimelineComponent data={baseData} />)).not.toThrow();
    } finally {
      if (original) prototype.scrollIntoView = original;
    }
  });

  it("renders through the default registry and falls back for an invalid payload", () => {
    const { unmount } = render(
      <RegistryProvider>
        <RegistryRenderer
          payload={{
            type: "execution_timeline",
            version: "1.0.0",
            requestId: "run-1",
            data: baseData,
          }}
        />
      </RegistryProvider>,
    );
    expect(screen.getByText("Current:")).toBeInTheDocument();
    unmount();

    render(
      <RegistryProvider>
        <RegistryRenderer
          payload={{
            type: "execution_timeline",
            version: "1.0.0",
            requestId: "run-1",
            data: { steps: [{ id: "x", name: "X", status: "bogus" }] },
          }}
        />
      </RegistryProvider>,
    );
    expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument();
  });
});

describe("executionTimelineSchema", () => {
  it("accepts a legacy minimal payload (no new fields)", () => {
    const parsed = executionTimelineSchema.parse({
      currentStep: "create_plan",
      steps: [{ id: "s1", name: "Plan", status: "running" }],
    });
    expect(parsed.currentStep).toBe("create_plan");
  });

  it("rejects an unknown status", () => {
    expect(
      executionTimelineSchema.safeParse({
        currentStep: "x",
        steps: [{ id: "s1", name: "Plan", status: "bogus" }],
      }).success,
    ).toBe(false);
  });
});
