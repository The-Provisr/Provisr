"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClarificationInputs } from "@/components/ui/clarification-inputs";
import { RotateCcwIcon } from "@/components/ui/icons";
import type {
  ClarificationAnswer,
  ClarificationAnswers,
  ClarificationQuestionPayload,
  ClarificationSubmitter,
} from "@/lib/clarification/types";
import { submitClarification } from "@/lib/clarification/submit";

type Phase = "default" | "submitting" | "submitted" | "error";

function initialValue(payload: ClarificationQuestionPayload): ClarificationAnswer | null {
  switch (payload.inputType) {
    case "multi_select":
      return [];
    case "boolean":
    case "confirmation":
      return null;
    default:
      return "";
  }
}

function isAnswerValid(
  value: ClarificationAnswer | null,
  payload: ClarificationQuestionPayload,
): value is ClarificationAnswer {
  switch (payload.inputType) {
    case "text":
    case "select":
      return (
        typeof value === "string" &&
        (!payload.required || value.trim() !== "")
      );
    case "multi_select":
      return (
        Array.isArray(value) &&
        (!payload.required || value.length > 0)
      );
    case "boolean":
    case "confirmation":
      return typeof value === "boolean";
  }
}

type ClarificationQuestionProps = {
  payload: ClarificationQuestionPayload;
  onSubmit: ClarificationSubmitter;
};

export function ClarificationQuestion({
  payload,
  onSubmit,
}: ClarificationQuestionProps) {
  const [value, setValue] = useState<ClarificationAnswer | null>(() =>
    initialValue(payload),
  );
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("default");
  const [errorMessage, setErrorMessage] = useState("");

  const invalid = !isAnswerValid(value, payload);
  const disabled = phase === "submitting";
  const inputId = `clarify-input-${payload.questionId}`;
  const questionLabelId = `clarify-label-${payload.questionId}`;
  const errorId = `clarify-error-${payload.questionId}`;

  async function submit(answer?: ClarificationAnswer | null) {
    const finalValue = answer ?? value;
    if (!isAnswerValid(finalValue, payload)) {
      setTouched(true);
      return;
    }
    setPhase("submitting");
    try {
      await onSubmit({ answers: { [payload.fieldMapping]: finalValue } });
      setPhase("submitted");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to submit answer",
      );
      setPhase("error");
    }
  }

  function handleChange(next: ClarificationAnswer) {
    setValue(next);
    setTouched(true);
  }

  if (phase === "submitted") {
    return (
      <div className="max-w-[480px] rounded-lg border border-gray-100 bg-white p-4">
        <p className="text-sm font-medium text-white" id={questionLabelId}>
          {payload.questionText}
        </p>
        <p className="mt-2 text-xs text-green-700">
          Answer saved — resuming run…
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="max-w-[480px] rounded-lg border border-l-2 border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-white" id={questionLabelId}>
          {payload.questionText}
        </p>
        <p className="mt-2 text-xs text-red-900" role="alert">
          {errorMessage}
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => submit(value)}
        >
          Retry
        </Button>
      </div>
    );
  }

  const showValidationError = touched && invalid;

  return (
    <div className="max-w-[480px] rounded-lg border border-gray-100 bg-white p-4">
      <p className="text-sm font-medium text-white" id={questionLabelId}>
        {payload.questionText}
        {payload.required ? (
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Required
          </span>
        ) : null}
      </p>

      <div className="mt-3">
        <ClarificationInputs
          payload={payload}
          value={value}
          onChange={handleChange}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          invalid={showValidationError}
          inputId={inputId}
          questionLabelId={questionLabelId}
          errorId={errorId}
        />
      </div>

      {payload.inputType === "confirmation" ? (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" disabled={disabled} onClick={() => submit(true)}>
            Confirm
          </Button>
          <Button variant="secondary" disabled={disabled} onClick={() => submit(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end">
          <Button
            className="disabled:opacity-50"
            variant="secondary"
            disabled={disabled || invalid}
            onClick={() => submit()}
          >
            {disabled ? (
              <>
                <RotateCcwIcon className="size-3.5 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

type AuthenticatedClarificationQuestionProps = {
  runId: string;
  payload: ClarificationQuestionPayload;
};

export function AuthenticatedClarificationQuestion({
  runId,
  payload,
}: AuthenticatedClarificationQuestionProps) {
  const { getToken } = useAuth();
  const onSubmit = async (answers: ClarificationAnswers) => {
    const token = await getToken();
    if (!token) {
      throw new Error("Authentication required");
    }
    await submitClarification(runId, payload.questionId, answers, token);
  };
  return <ClarificationQuestion payload={payload} onSubmit={onSubmit} />;
}
