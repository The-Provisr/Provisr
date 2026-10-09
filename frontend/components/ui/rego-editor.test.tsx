import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegoEditor, tokenizeRego } from "@/components/ui/rego-editor";
import { policyPacks } from "@/lib/policy/mock-data";

const source = policyPacks[0]!.rules[0]!.regoSource;

describe("tokenizeRego", () => {
  it("classifies keywords, strings, and comments", () => {
    const tokens = tokenizeRego('package provisr.aws.s3  # base rule');
    const keyword = tokens.find((token) => token.text === "package");
    const comment = tokens.find((token) => token.text === "# base rule");
    expect(keyword?.className).toContain("text-blue-700");
    expect(keyword?.className).toContain("font-semibold");
    expect(comment?.className).toContain("italic");
    const stringTokens = tokenizeRego('msg := "hello"');
    expect(stringTokens.find((token) => token.text === '"hello"')?.className).toContain("text-red-900");
  });
});

describe("RegoEditor", () => {
  it("renders the highlighted source read-only for non-admins", () => {
    render(<RegoEditor isAdmin={false} source={source} />);
    expect(screen.getByTestId("rego-view")).toBeInTheDocument();
    expect(screen.getByText(/admins only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("keeps the raw source text visible", () => {
    render(<RegoEditor isAdmin={false} source={source} />);
    expect(screen.getByText(/Base policy definition for aws_s3_bucket_public_access/)).toBeInTheDocument();
  });

  it("lets admins edit and save", () => {
    const onChange = vi.fn();
    render(<RegoEditor isAdmin onChange={onChange} source={source} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const editor = screen.getByLabelText("Rego policy editor");
    expect(editor).toBeVisible();
    fireEvent.change(editor, { target: { value: "package provisr.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(onChange).toHaveBeenCalledWith("package provisr.test");
  });

  it("cancels edits without notifying", () => {
    const onChange = vi.fn();
    render(<RegoEditor isAdmin onChange={onChange} source={source} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText("Rego policy editor"), { target: { value: "broken" } });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Base policy definition for aws_s3_bucket_public_access/)).toBeInTheDocument();
  });
});