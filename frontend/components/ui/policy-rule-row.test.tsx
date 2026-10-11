import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PolicyRuleRow } from "@/components/ui/policy-rule-row";
import { policyPacks } from "@/lib/policy/mock-data";

const rule = policyPacks[0]!.rules[0]!;

describe("PolicyRuleRow", () => {
  it("shows key, severity, and description when collapsed", () => {
    render(<PolicyRuleRow enabled={rule.enabled} rule={rule} />);
    expect(screen.getByText("aws_s3_bucket_public_access")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
    expect(screen.getByText(/Ensure all S3 buckets/)).toBeInTheDocument();
    expect(screen.queryByTestId("rule-detail")).not.toBeInTheDocument();
  });

  it("expands and collapses on click", () => {
    render(<PolicyRuleRow enabled={rule.enabled} rule={rule} />);
    fireEvent.click(screen.getByTestId("rule-row"));
    expect(screen.getByTestId("rule-detail")).toBeInTheDocument();
    expect(screen.getByText(/Rule Parameters/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rule-row"));
    expect(screen.queryByTestId("rule-detail")).not.toBeInTheDocument();
  });

  it("reports enabled changes without toggling expansion", () => {
    const onEnabledChange = vi.fn();
    render(<PolicyRuleRow enabled={rule.enabled} onEnabledChange={onEnabledChange} rule={rule} />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle rule aws_s3_bucket_public_access" }));
    expect(onEnabledChange).toHaveBeenCalledWith("aws_s3_bucket_public_access", false);
    expect(screen.queryByTestId("rule-detail")).not.toBeInTheDocument();
  });

  it("updates text parameters and lifts changes", () => {
    const onParametersChange = vi.fn();
    render(
      <PolicyRuleRow
        defaultExpanded
        enabled={rule.enabled}
        onParametersChange={onParametersChange}
        rule={rule}
      />,
    );
    const input = screen.getByLabelText(/Exempted Buckets/);
    fireEvent.change(input, { target: { value: "web-assets-prod" } });
    expect(onParametersChange).toHaveBeenCalledWith(
      "aws_s3_bucket_public_access",
      expect.arrayContaining([
        expect.objectContaining({ key: "exempt_buckets", value: "web-assets-prod" }),
      ]),
    );
  });

  it("toggles multi-select chips", () => {
    const onParametersChange = vi.fn();
    render(
      <PolicyRuleRow
        defaultExpanded
        enabled={rule.enabled}
        onParametersChange={onParametersChange}
        rule={rule}
      />,
    );
    const warnChip = screen.getByRole("button", { name: "warn" });
    expect(warnChip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(warnChip);
    const chipped = expect.arrayContaining([
      expect.objectContaining({
        key: "action_on_violation",
        value: expect.arrayContaining(["warn"]),
      }),
    ]);
    expect(onParametersChange).toHaveBeenCalledWith("aws_s3_bucket_public_access", chipped);
  });

  it("renders the remediation hint and docs link when expanded", () => {
    render(<PolicyRuleRow defaultExpanded enabled={rule.enabled} rule={rule} />);
    expect(screen.getByText(/block_public_acls = true/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View documentation/ })).toHaveAttribute(
      "href",
      "https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html",
    );
  });

  it("lifts rego edits for admins", () => {
    const onRegoChange = vi.fn();
    render(
      <PolicyRuleRow
        defaultExpanded
        enabled={rule.enabled}
        isAdmin
        onRegoChange={onRegoChange}
        rule={rule}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const editor = screen.getByLabelText("Rego policy editor");
    fireEvent.change(editor, { target: { value: "package test" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(onRegoChange).toHaveBeenCalledWith("aws_s3_bucket_public_access", "package test");
  });
});