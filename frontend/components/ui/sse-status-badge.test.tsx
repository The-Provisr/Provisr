import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SSEStatusBadge } from "@/components/ui/sse-status-badge";
import type { SSEStatus } from "@/lib/sse/types";

describe("SSEStatusBadge", () => {
  const cases: Array<{
    status: SSEStatus;
    label: string;
    dotClass: string;
  }> = [
    { status: "connected", label: "Live", dotClass: "bg-green-500" },
    { status: "connecting", label: "Connecting", dotClass: "bg-amber-500" },
    { status: "reconnecting", label: "Reconnecting", dotClass: "bg-amber-500" },
    { status: "disconnected", label: "Offline", dotClass: "bg-red-500" },
  ];

  for (const { status, label, dotClass } of cases) {
    it(`renders ${label} for the ${status} status`, () => {
      render(<SSEStatusBadge status={status} />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent(label);
      const dot = badge.querySelector("span");
      expect(dot?.className).toContain(dotClass);
    });
  }

  it("renders the red offline state for disconnected", () => {
    render(<SSEStatusBadge status="disconnected" />);
    const badge = screen.getByRole("status");
    expect(badge.className).toContain("border-red-200");
    expect(badge.className).toContain("bg-red-50");
  });
});
