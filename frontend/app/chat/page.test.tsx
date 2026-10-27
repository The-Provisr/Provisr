import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sse = vi.hoisted(() => ({
  status: "connected" as const,
  handlers: new Map<string, (event: unknown) => void>(),
}));

vi.mock("@/lib/sse/use-sse", () => ({
  useSSE: () => ({
    status: sse.status,
    lastEventId: null,
    subscribe: (type: string, handler: (event: unknown) => void) => {
      sse.handlers.set(type, handler);
      return () => {
        sse.handlers.delete(type);
      };
    },
  }),
}));

vi.mock("@/components/ui/provisr-app", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ChatPage from "./page";

function emitStateChange(data: Record<string, unknown>) {
  const handler = sse.handlers.get("run_state_changed");
  expect(handler).toBeDefined();
  act(() => {
    handler!({ type: "run_state_changed", id: "evt-1", data });
  });
}

beforeEach(() => {
  sse.handlers.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChatPage execution timeline (FE-C20)", () => {
  it("renders the live timeline seeded at the plan review checkpoint", () => {
    render(<ChatPage />);

    // The demo run sits at POLICY_CHECKING: earlier stages succeeded,
    // clarification was skipped, later stages pending.
    const current = screen
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveTextContent("Policy check");
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByText("Manifest v2")).toBeInTheDocument();
  });

  it("advances the timeline when a run_state_changed event arrives", () => {
    render(<ChatPage />);
    expect(screen.queryByText("Run completed")).not.toBeInTheDocument();

    for (const state of ["CONFIRMING", "APPROVING", "EXECUTING", "COMPLETED"]) {
      emitStateChange({
        run_id: "run-demo-001",
        from: "x",
        to: state,
      });
    }

    expect(screen.getByText("Run completed")).toBeInTheDocument();
    // The manifest artifact chip derived from the run seed is still present.
    expect(screen.getByText("Manifest v2")).toBeInTheDocument();
  });

  it("ignores run_state_changed events for other runs", () => {
    render(<ChatPage />);

    emitStateChange({
      run_id: "run-other-999",
      from: "POLICY_CHECKING",
      to: "EXECUTING",
    });

    const current = screen
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveTextContent("Policy check");
    expect(screen.queryByText("Run completed")).not.toBeInTheDocument();
  });

  it("ignores malformed events (no target state)", () => {
    render(<ChatPage />);

    emitStateChange({ run_id: "run-demo-001", from: "x" });
    emitStateChange({ run_id: "run-demo-001", from: "x", to: "NOT_A_STATE" });

    const current = screen
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveTextContent("Policy check");
  });
});
