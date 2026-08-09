import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClarificationQuestion } from "@/components/ui/clarification-question";
import type {
  ClarificationQuestionPayload,
  ClarificationSubmitter,
} from "@/lib/clarification/types";

function makePayload(
  overrides: Partial<ClarificationQuestionPayload> = {},
): ClarificationQuestionPayload {
  return {
    questionId: "q1",
    questionText: "Which AWS region?",
    inputType: "select",
    options: ["us-east-1", "eu-west-1"],
    required: true,
    fieldMapping: "region",
    ...overrides,
  };
}

function renderQuestion(payload: ClarificationQuestionPayload) {
  const onSubmit = vi.fn<ClarificationSubmitter>();
  const utils = render(
    <ClarificationQuestion payload={payload} onSubmit={onSubmit} />,
  );
  return { onSubmit, ...utils };
}

describe("ClarificationQuestion", () => {
  it("renders the question text and the required badge", () => {
    renderQuestion(makePayload());
    expect(screen.getByText("Which AWS region?")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("omits the required badge for optional questions", () => {
    renderQuestion(makePayload({ required: false }));
    expect(screen.queryByText("Required")).toBeNull();
  });

  it("text: disables submit until a non-empty answer, shows validation error on blur", async () => {
    const { onSubmit } = renderQuestion(
      makePayload({ inputType: "text", options: undefined }),
    );
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();

    const input = screen.getByRole("textbox", { name: "Which AWS region?" });
    fireEvent.blur(input);
    expect(screen.getByText("This field is required.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "us-east-1" } });
    expect(screen.queryByText("This field is required.")).toBeNull();
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ answers: { region: "us-east-1" } }),
    );
  });

  it("text: optional questions are submittable while empty", () => {
    renderQuestion(
      makePayload({ inputType: "text", options: undefined, required: false }),
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("select: renders options and submits the chosen value", async () => {
    const { onSubmit } = renderQuestion(makePayload());
    const select = screen.getByRole("combobox", { name: "Which AWS region?" });
    expect(screen.getByRole("option", { name: "us-east-1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "eu-west-1" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "eu-west-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ answers: { region: "eu-west-1" } }),
    );
  });

  it("multi_select: toggles chips and submits the selected array", async () => {
    const { onSubmit } = renderQuestion(
      makePayload({ inputType: "multi_select" }),
    );
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();

    const chip = screen.getByRole("button", { name: "us-east-1" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(submit).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "eu-west-1" }));
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(submit);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ answers: { region: ["eu-west-1"] } }),
    );
  });

  it("boolean: disables submit until chosen, submits the boolean", async () => {
    const { onSubmit } = renderQuestion(
      makePayload({ inputType: "boolean", options: undefined }),
    );
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ answers: { region: true } }),
    );
  });

  it("confirmation: confirm submits true, cancel submits false", async () => {
    const { onSubmit } = renderQuestion(
      makePayload({ inputType: "confirmation", options: undefined }),
    );
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ answers: { region: true } }),
    );
  });

  it("confirmation: cancel submits false", async () => {
    const { onSubmit } = renderQuestion(
      makePayload({ inputType: "confirmation", options: undefined }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ answers: { region: false } }),
    );
  });

  it("submitting: shows spinner and disables inputs while pending", () => {
    renderQuestion(makePayload({ inputType: "text", options: undefined }));
    const submit = screen.getByRole("button", { name: "Submit" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "prod" },
    });
    fireEvent.click(submit);
    expect(screen.getByText("Submitting…")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("submitted: collapses inputs and shows the confirmation", async () => {
    renderQuestion(makePayload({ inputType: "text", options: undefined }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "prod" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText("Answer saved — resuming run…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("error: shows the message and retry resubmits", async () => {
    const onSubmit = vi.fn<ClarificationSubmitter>();
    onSubmit
      .mockRejectedValueOnce(new Error("submitClarification failed: 501"))
      .mockResolvedValueOnce();

    render(
      <ClarificationQuestion
        payload={makePayload({ inputType: "text", options: undefined })}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "prod" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText("submitClarification failed: 501"),
    ).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("Answer saved — resuming run…"),
    ).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
