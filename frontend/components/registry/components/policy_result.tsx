import { z } from "zod";
import { defaultRegistry } from "../registry";

export const policyResultSchema = z.object({
  status: z.enum(["passed", "failed", "warning", "pending"]),
  packName: z.string().optional(),
  evaluatedCount: z.number(),
  passedCount: z.number(),
  violations: z
    .array(
      z.object({
        ruleId: z.string(),
        severity: z.enum(["critical", "high", "medium", "low"]),
        message: z.string(),
        remediation: z.string().optional(),
      }),
    )
    .optional(),
});

export type PolicyResultData = z.infer<typeof policyResultSchema>;

export function PolicyResultComponent({ data }: { data: PolicyResultData }) {
  const isPassed = data.status === "passed";

  return (
    <div
      className={`rounded-xl border p-5 shadow-xs ${
        isPassed ? "border-green-200 bg-green-50/20" : "border-red-200 bg-red-50/20"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            isPassed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
        >
          Policy Gate: {data.status.toUpperCase()}
        </span>
        <span className="text-xs text-gray-500 font-medium">
          {data.passedCount} / {data.evaluatedCount} Rules Passed
        </span>
      </div>

      {data.packName ? (
        <h3 className="mt-2 text-sm font-semibold text-gray-900">Policy Pack: {data.packName}</h3>
      ) : null}

      {data.violations && data.violations.length > 0 ? (
        <div className="mt-3 space-y-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-600">
            Violations ({data.violations.length})
          </span>
          {data.violations.map((v) => (
            <div key={v.ruleId} className="rounded-lg border border-red-100 bg-white p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium text-gray-800">{v.ruleId}</span>
                <span className="rounded bg-red-100 px-1.5 py-0.2 text-[9px] font-bold uppercase text-red-700">
                  {v.severity}
                </span>
              </div>
              <p className="mt-1 text-gray-700">{v.message}</p>
              {v.remediation ? (
                <p className="mt-1 text-[11px] text-gray-500 italic">Fix: {v.remediation}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-green-700 font-medium">
          ✓ All workspace governance and compliance guardrails passed.
        </p>
      )}
    </div>
  );
}

defaultRegistry.register({
  type: "policy_result",
  version: "1.0",
  schema: policyResultSchema,
  component: PolicyResultComponent,
});
