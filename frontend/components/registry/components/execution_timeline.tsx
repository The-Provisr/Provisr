import { useEffect, useRef, type ComponentType } from "react";
import { z } from "zod";
import { defaultRegistry } from "../registry";

import { executionTimelineSchema } from "@provisr/shared-contracts";
export { executionTimelineSchema } from "@provisr/shared-contracts";

import { CheckIcon, AlertTriangleIcon, BanIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatDurationMs } from "@/lib/format";
import { formatStageTime } from "@/lib/runs/timeline";

export type ExecutionTimelineData = z.infer<typeof executionTimelineSchema>;

const STATUS_LABELS: Record<ExecutionTimelineData["steps"][number]["status"], string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<
  ExecutionTimelineData["steps"][number]["status"],
  { dot: string; icon: string; iconComponent?: ComponentType<{ className?: string }> }
> = {
  pending: {
    dot: "border border-gray-300 bg-white",
    icon: "",
  },
  running: {
    dot: "bg-blue-500",
    icon: "",
  },
  succeeded: {
    dot: "bg-green-500",
    icon: "text-green-600",
    iconComponent: CheckIcon,
  },
  failed: {
    dot: "bg-red-500",
    icon: "text-red-600",
    iconComponent: AlertTriangleIcon,
  },
  cancelled: {
    dot: "bg-gray-400",
    icon: "text-gray-500",
    iconComponent: BanIcon,
  },
  skipped: {
    dot: "bg-gray-200",
    icon: "",
  },
};

const TERMINAL_HEADLINES: Partial<Record<ExecutionTimelineData["steps"][number]["status"], string>> = {
  failed: "Run failed",
  cancelled: "Run cancelled",
  succeeded: "Run completed",
};

function StepStatusIcon({ status }: { status: ExecutionTimelineData["steps"][number]["status"] }) {
  const style = STATUS_STYLES[status];
  if (!style.iconComponent) {
    return <span className={cn("size-2.5 rounded-full", style.dot, status === "running" && "animate-pulse")} />;
  }
  const Icon = style.iconComponent;
  return <Icon className={cn("size-4", style.icon)} />;
}

export function ExecutionTimelineComponent({
  data,
  autoFollow = true,
}: {
  data: ExecutionTimelineData;
  /** Scroll the running step into view as the run progresses. */
  autoFollow?: boolean;
}) {
  const runningRef = useRef<HTMLLIElement | null>(null);
  const currentStep = data.steps.find((step) => step.status === "running") ?? null;
  const terminalStep =
    data.steps.find((step) => step.status === "failed" || step.status === "cancelled") ?? null;
  const allSettled =
    !currentStep &&
    data.steps.every(
      (step) => step.status === "succeeded" || step.status === "skipped",
    );
  const headline = terminalStep
    ? TERMINAL_HEADLINES[terminalStep.status]
    : allSettled
      ? TERMINAL_HEADLINES.succeeded
      : null;

  useEffect(() => {
    if (!autoFollow) return;
    const node = runningRef.current;
    if (!node || typeof node.scrollIntoView !== "function") return;
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [autoFollow, currentStep?.id]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="pb-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">
          FSM Orchestrator Pipeline (PRD §9)
        </span>
        <h3 className="mt-0.5 text-sm font-semibold text-gray-900">
          {headline ?? (
            <>
              Current: <span className="font-mono text-purple-700">{data.currentStep}</span>
            </>
          )}
        </h3>
        <p className="mt-0.5 text-xs text-gray-400" aria-live="polite">
          {currentStep
            ? `${currentStep.name} is running.`
            : (terminalStep ? `${terminalStep.name}: ${STATUS_LABELS[terminalStep.status]}.` : data.currentStep)}
        </p>
      </div>

      <ol className="relative space-y-1">
        {data.steps.map((step, index) => {
          const style = STATUS_STYLES[step.status];
          const isRunning = step.status === "running";
          return (
            <li
              aria-current={isRunning ? "step" : undefined}
              className="relative flex gap-3 rounded-lg px-2 py-2"
              data-step-status={step.status}
              key={step.id}
              ref={isRunning ? runningRef : undefined}
            >
              {index < data.steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[15px] top-8 h-[calc(100%-8px)] w-px",
                    step.status === "succeeded" ? "bg-green-200" : "bg-gray-200",
                  )}
                />
              ) : null}
              <span className="relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-white">
                <StepStatusIcon status={step.status} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <span className={cn("text-xs font-medium", step.status === "pending" || step.status === "skipped" ? "text-gray-400" : "text-gray-800")}>
                    {step.name}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                      step.status === "succeeded" && "bg-green-100 text-green-700",
                      step.status === "running" && "bg-blue-100 text-blue-700",
                      step.status === "failed" && "bg-red-100 text-red-700",
                      step.status === "cancelled" && "bg-gray-200 text-gray-600",
                      step.status === "skipped" && "bg-gray-100 text-gray-400",
                      step.status === "pending" && "bg-gray-100 text-gray-500",
                    )}
                  >
                    {STATUS_LABELS[step.status]}
                  </span>
                </div>

                {step.description ? (
                  <p className="mt-0.5 text-[11px] leading-4 text-gray-400">{step.description}</p>
                ) : null}

                {step.startedAt || step.completedAt || step.durationMs !== undefined ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-gray-400">
                    {step.startedAt ? <span>Started {formatStageTime(step.startedAt)}</span> : null}
                    {step.completedAt ? <span>Finished {formatStageTime(step.completedAt)}</span> : null}
                    {step.durationMs !== undefined ? <span>{formatDurationMs(step.durationMs)}</span> : null}
                  </div>
                ) : null}

                {step.artifacts?.length ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {step.artifacts.map((artifact) => (
                      <li key={artifact.id}>
                        {artifact.url ? (
                          <a
                            className="inline-flex items-center gap-1 rounded-md border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-100"
                            href={artifact.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {artifact.title}
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md border border-gray-100 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                            {artifact.title}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

defaultRegistry.register({
  type: "execution_timeline",
  version: "1.0",
  schema: executionTimelineSchema,
  component: ExecutionTimelineComponent,
});
