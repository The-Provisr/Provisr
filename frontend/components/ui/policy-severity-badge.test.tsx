import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PolicySeverityBadge } from "@/components/ui/policy-severity-badge";

describe("PolicySeverityBadge", () => {
  it.each([
    ["deny", "Deny"],
    ["warn", "Warn"],
    ["approval", "Approval Required"],
  ] as const)("renders the %s severity label", (severity, label) => {
    render(<PolicySeverityBadge severity={severity} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});