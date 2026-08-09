import type { ComponentProps } from "react";
import type {
  ClarificationAnswer,
  ClarificationQuestionPayload,
} from "@/lib/clarification/types";

type ClarificationInputsProps = {
  payload: ClarificationQuestionPayload;
  value: ClarificationAnswer | null;
  onChange: (value: ClarificationAnswer) => void;
  onBlur?: () => void;
  disabled: boolean;
  invalid: boolean;
  inputId: string;
  questionLabelId: string;
  errorId: string;
};

const inputBase =
  "w-full rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100";

const chipBase =
  "rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100";
const chipIdle = "border-gray-100 bg-white text-gray-400";
const chipActive = "border-blue-200 bg-blue-50 text-white";

function ValidationError({
  errorId,
  invalid,
  disabled,
}: {
  errorId: string;
  invalid: boolean;
  disabled: boolean;
}) {
  if (!invalid || disabled) {
    return null;
  }
  return (
    <p className="mt-2 text-xs text-red-900" id={errorId} role="alert">
      This field is required.
    </p>
  );
}

function TextInput({
  payload,
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
  inputId,
  errorId,
}: ClarificationInputsProps) {
  const inputProps: ComponentProps<"input"> = {
    id: inputId,
    type: "text",
    "aria-label": payload.questionText,
    value: typeof value === "string" ? value : "",
    onChange: (event) => onChange(event.target.value),
    onBlur,
    disabled,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId : undefined,
  };
  return (
    <div>
      <input
        {...inputProps}
        className={invalid ? `${inputBase} border-red-200` : inputBase}
      />
      <ValidationError errorId={errorId} invalid={invalid} disabled={disabled} />
    </div>
  );
}

function SelectInput({
  payload,
  value,
  onChange,
  disabled,
  invalid,
  inputId,
  errorId,
}: ClarificationInputsProps) {
  const selected = typeof value === "string" ? value : "";
  return (
    <div>
      <select
        id={inputId}
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={payload.questionText}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className={invalid ? `${inputBase} border-red-200` : inputBase}
      >
        <option value="" disabled>
          Select…
        </option>
        {(payload.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ValidationError errorId={errorId} invalid={invalid} disabled={disabled} />
    </div>
  );
}

function MultiSelectInput({
  payload,
  value,
  onChange,
  disabled,
  invalid,
  inputId,
  questionLabelId,
  errorId,
}: ClarificationInputsProps) {
  const selected = Array.isArray(value) ? value : [];
  return (
    <div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-labelledby={questionLabelId}
      >
        {(payload.options ?? []).map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((item) => item !== option)
                    : [...selected, option],
                )
              }
              className={`${chipBase} ${active ? chipActive : chipIdle}`}
            >
              {option}
            </button>
          );
        })}
      </div>
      <ValidationError errorId={errorId} invalid={invalid} disabled={disabled} />
    </div>
  );
}

function BooleanInput({
  payload,
  value,
  onChange,
  disabled,
  invalid,
  inputId,
  questionLabelId,
  errorId,
}: ClarificationInputsProps) {
  return (
    <div>
      <div
        className="flex items-center gap-2"
        role="group"
        aria-labelledby={questionLabelId}
      >
        {[true, false].map((choice) => {
          const active = value === choice;
          return (
            <button
              key={String(choice)}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(choice)}
              className={`${chipBase} ${active ? chipActive : chipIdle}`}
            >
              {choice ? "Yes" : "No"}
            </button>
          );
        })}
      </div>
      <ValidationError errorId={errorId} invalid={invalid} disabled={disabled} />
    </div>
  );
}

export function ClarificationInputs(props: ClarificationInputsProps) {
  switch (props.payload.inputType) {
    case "text":
      return <TextInput {...props} />;
    case "select":
      return <SelectInput {...props} />;
    case "multi_select":
      return <MultiSelectInput {...props} />;
    case "boolean":
      return <BooleanInput {...props} />;
    case "confirmation":
      return null;
  }
}
