import { z } from "zod";
import { defaultRegistry } from "../registry";

export const executionTimelineSchema = z.object({
  currentStep: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
      durationMs: z.number().optional(),
      startedAt: z.string().optional(),
      completedAt: z.string().optional(),
    }),
  ),
});

export type ExecutionTimelineData = z.infer<typeof executionTimelineSchema>;

export function ExecutionTimelineComponent({
  data,
}: {
  data: ExecutionTimelineData;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between pb-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">
            FSM Orchestrator Pipeline (PRD §9)
          </span>
          <h3 className="text-sm font-semibold text-gray-900">
            Current: <span className="font-mono text-purple-700">{data.currentStep}</span>
          </h3>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {data.steps.map((step, idx) => (
          <div
            key={step.id}
            className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/60 p-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-gray-400">{idx + 1}.</span>
              <span className="font-medium text-gray-800">{step.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {step.durationMs ? (
                <span className="text-[10px] text-gray-400 font-mono">{step.durationMs}ms</span>
              ) : null}
              <span
                className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                  step.status === "succeeded"
                    ? "bg-green-100 text-green-700"
                    : step.status === "running"
                      ? "bg-blue-100 text-blue-700 animate-pulse"
                      : step.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-200 text-gray-600"
                }`}
              >
                {step.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "execution_timeline",
  version: "1.0",
  schema: executionTimelineSchema,
  component: ExecutionTimelineComponent,
});
