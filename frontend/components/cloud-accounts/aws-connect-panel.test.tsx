import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwsConnectPanel } from "./aws-connect-panel";

const EXTERNAL_ID = "prv_aws_0123456789abcdef0123456789abcdef0123456789abcdef";

function renderPanel(overrides: Partial<Parameters<typeof AwsConnectPanel>[0]> = {}) {
  return render(
    <AwsConnectPanel
      busy={false}
      externalId={EXTERNAL_ID}
      onCancel={vi.fn()}
      onVerify={vi.fn()}
      workspaceId="ws-123"
      {...overrides}
    />,
  );
}

describe("AwsConnectPanel", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PROVISR_AWS_ACCOUNT_ID", "111122223333");
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("masks the external id until revealed", () => {
    renderPanel();
    const masked = `prv_aws_0123${"•".repeat(12)}`;
    expect(screen.getByLabelText("External ID")).toHaveTextContent(masked);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(screen.getByLabelText("External ID")).toHaveTextContent(EXTERNAL_ID);
  });

  it("renders a CloudFormation template referencing the external id", () => {
    renderPanel();
    const template = screen.getByLabelText("CloudFormation template");
    expect(template).toHaveTextContent("sts:ExternalId: !Ref ExternalId");
    expect(template).toHaveTextContent(EXTERNAL_ID);
  });

  it("gates verification on a valid role ARN", () => {
    const onVerify = vi.fn();
    renderPanel({ onVerify });

    const verifyButton = screen.getByRole("button", { name: "Verify connection" });
    expect(verifyButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Role ARN"), {
      target: { value: "not-an-arn" },
    });
    expect(screen.getByText("Enter a valid IAM role ARN.")).toBeInTheDocument();
    expect(verifyButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Role ARN"), {
      target: { value: "arn:aws:iam::123456789012:role/ProvisrExecutionRole" },
    });
    expect(verifyButton).toBeEnabled();

    fireEvent.click(verifyButton);
    expect(onVerify).toHaveBeenCalledWith({
      externalId: EXTERNAL_ID,
      roleArn: "arn:aws:iam::123456789012:role/ProvisrExecutionRole",
      label: "AWS account",
    });
  });

  it("shows a verifying label when busy and blocks actions", () => {
    renderPanel({ busy: true });
    expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("surfaces an error and offers retry affordance", () => {
    renderPanel({ errorMessage: "External ID mismatch" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("External ID mismatch");
  });

  it("blocks new setup when platform account is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_PROVISR_AWS_ACCOUNT_ID", "");
    renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("not configured");
    expect(screen.queryByLabelText("CloudFormation template")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify connection" })).toBeDisabled();
  });

  it("asks existing connections for the original external ID without ignored role edits", () => {
    const onExternalIdChange = vi.fn();
    renderPanel({ accountId: "existing", externalId: "", onExternalIdChange });
    expect(screen.getByRole("button", { name: "Verify connection" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Original external ID"), { target: { value: "original-id" } });
    expect(onExternalIdChange).toHaveBeenCalledWith("original-id");
    expect(screen.queryByLabelText("Role ARN")).not.toBeInTheDocument();
  });

  it("copies the external id to the clipboard", async () => {
    renderPanel();
    // Two Copy buttons exist (external id and template); the external id is first.
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]!);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(EXTERNAL_ID),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
