"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { submitClarification } from "@/lib/clarification/submit";
import { defaultRegistry } from "../registry";

import { clarificationQuestionSchema } from "@provisr/shared-contracts";
export { clarificationQuestionSchema } from "@provisr/shared-contracts";

export type ClarificationQuestionData = z.infer<typeof clarificationQuestionSchema>;

export function ClarificationQuestionComponent({
  data,
}: {
  data: ClarificationQuestionData;
}) {
  const { getToken } = useAuth();
  const [answer, setAnswer] = useState<string | string[]>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const empty = Array.isArray(answer) ? answer.length === 0 : !answer.trim();
    if (empty || submitting || data.answered) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again to continue.");
      const submittedAnswer = data.inputType === "confirmation"
        ? answer === "true"
        : Array.isArray(answer)
          ? answer
          : answer.trim();
      await submitClarification(data.id, data.id, { answers: { answer: submittedAnswer } }, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit your answer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
          Clarification Needed
        </span>
        {data.answered ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-700">
            Answered
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">{data.question}</h3>
      {data.description ? (
        <p className="mt-1 text-xs text-gray-600 leading-relaxed">{data.description}</p>
      ) : null}

      {data.inputType === "confirmation" ? (
        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={answer === "true"} onChange={(event) => setAnswer(String(event.target.checked))} disabled={data.answered || submitting} />
          Confirm this detail
        </label>
      ) : data.options?.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.options.map((opt) => {
            const selected = Array.isArray(answer) ? answer.includes(opt.value) : answer === opt.value;
            return <button key={opt.value} type="button" disabled={data.answered || submitting} aria-pressed={selected} onClick={() => {
              if (data.inputType === "multi_select") {
                const selectedValues = Array.isArray(answer) ? answer : [];
                setAnswer(selectedValues.includes(opt.value) ? selectedValues.filter((value) => value !== opt.value) : [...selectedValues, opt.value]);
              } else setAnswer(opt.value);
            }} className={`flex flex-col rounded-lg border p-3 text-left ${selected ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white hover:border-blue-300"}`}>
              <span className="font-medium text-sm text-gray-800">{opt.label}</span>
              {opt.description ? <span className="mt-0.5 text-xs text-gray-500">{opt.description}</span> : null}
            </button>;
          })}
        </div>
      ) : (
        <input aria-label="Your answer" className="mt-4 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400" value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={data.answered || submitting} />
      )}
      {!data.answered ? <Button className="mt-3" variant="primary" onClick={() => void submit()} disabled={(Array.isArray(answer) ? answer.length === 0 : !answer.trim()) || submitting}>{submitting ? "Submitting..." : "Continue"}</Button> : null}
      {error ? <p className="mt-2 text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}

defaultRegistry.register({
  type: "clarification_question",
  version: "1.0",
  schema: clarificationQuestionSchema,
  component: ClarificationQuestionComponent,
});
