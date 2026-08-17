import { z } from "zod";
import { defaultRegistry } from "../registry";

export const clarificationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  description: z.string().optional(),
  inputType: z.enum(["single_select", "multi_select", "text", "confirmation"]),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  selected: z.union([z.string(), z.array(z.string())]).optional(),
  answered: z.boolean().optional(),
});

export type ClarificationQuestionData = z.infer<typeof clarificationQuestionSchema>;

export function ClarificationQuestionComponent({
  data,
}: {
  data: ClarificationQuestionData;
}) {
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

      {data.options && data.options.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.options.map((opt) => (
            <div
              key={opt.value}
              className="flex flex-col rounded-lg border border-gray-200 bg-white p-3 hover:border-blue-300 hover:bg-blue-50/20"
            >
              <span className="font-medium text-sm text-gray-800">{opt.label}</span>
              {opt.description ? (
                <span className="mt-0.5 text-xs text-gray-500">{opt.description}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "clarification_question",
  version: "1.0",
  schema: clarificationQuestionSchema,
  component: ClarificationQuestionComponent,
});
