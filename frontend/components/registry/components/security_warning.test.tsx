import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SecurityWarningComponent, securityWarningSchema } from "./security_warning";
import { RegistryProvider } from "../RegistryProvider";
import { RegistryRenderer } from "../RegistryRenderer";

const high = { title: "Public S3 Bucket", severity: "high", description: "The bucket permits public access.",
  affectedResource: "assets", suggestedFix: "Block public access." };
const low = { title: "Short log retention", severity: "low", description: "Logs expire quickly." };

describe("FE-C16 security review", () => {
  it("groups urgent findings first, counts them and retains fixes", () => {
    render(<SecurityWarningComponent data={{ findings: [low, high, { ...high, title: "Unencrypted Storage" }] }} />);
    expect(screen.getByRole("alert")).toHaveAccessibleName("Security warnings (3)");
    expect(screen.getByRole("heading", { name: "High (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Low (1)" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 4 })[0]).toHaveTextContent("High");
    expect(screen.getAllByText("Block public access.")).toHaveLength(2);
  });

  it("preserves the original single-warning payload and mitigation list", () => {
    render(<SecurityWarningComponent data={{ title: "IAM Wildcard Permission", severity: "critical",
      description: "The role grants broad access.", mitigationSteps: ["Scope the role."] }} />);
    expect(screen.getByText("Critical (1)")).toBeInTheDocument();
    expect(screen.getByText("Scope the role.")).toBeInTheDocument();
  });

  it("shows clear only for an explicit empty findings list", () => {
    render(<SecurityWarningComponent data={{ findings: [] }} />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Security review clear");
    expect(screen.getByText("No security warnings")).toBeInTheDocument();
    expect(screen.queryByText(/all checks passed/i)).not.toBeInTheDocument();
  });

  it.each([undefined, {}, { findings: null }, { findings: [{ ...high, severity: "unknown" }] },
    { findings: [], ...high }, { findings: [{ ...high, title: " " }] }])("never implies safety for invalid data: %j", data => {
    render(<SecurityWarningComponent data={data} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Security findings unavailable");
    expect(screen.queryByText("No security warnings")).not.toBeInTheDocument();
    expect(securityWarningSchema.safeParse(data).success).toBe(false);
  });

  it("does not show a clear result while loading", () => {
    render(<SecurityWarningComponent state="loading" data={{ findings: [] }} />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading security warnings");
    expect(screen.queryByText("No security warnings")).not.toBeInTheDocument();
  });

  it("escapes finding text instead of rendering injected HTML", () => {
    const { container } = render(<SecurityWarningComponent data={{ ...high,
      description: "<img src=x onerror=alert(1)>" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("renders through the real registry and rejects mixed payloads", () => {
    const { rerender } = render(<RegistryProvider><RegistryRenderer payload={{ type: "security_warning",
      version: "1.0", requestId: "test", data: { findings: [high] } }} /></RegistryProvider>);
    expect(screen.getByText("Public S3 Bucket")).toBeInTheDocument();
    rerender(<RegistryProvider><RegistryRenderer payload={{ type: "security_warning", version: "1.0",
      requestId: "test", data: { findings: [], ...high } }} /></RegistryProvider>);
    expect(screen.getByText("Invalid payload")).toBeInTheDocument();
    expect(screen.queryByText("No security warnings")).not.toBeInTheDocument();
  });
});
