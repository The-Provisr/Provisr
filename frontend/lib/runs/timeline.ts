/**
 * Client-side derivation of the execution timeline for a provisioning run.
 *
 * The orchestrator FSM (PRD §9) owns the actual state machine
 * (orchestrator/src/state-machine). This module mirrors its states to render a
 * user-facing stage list; it never drives transitions, only projects them.
 */

export const PROVISIONING_RUN_STATES = [
  "RECEIVED",
  "POLICY_LOADED",
  "CLOUD_CONTEXT_LOADED",
  "CLARIFYING",
  "MANIFEST_CREATING",
  "MANIFEST_VALIDATING",
  "IAC_GENERATING",
  "PLAN_CREATING",
  "POLICY_CHECKING",
  "CONFIRMING",
  "APPROVING",
  "EXECUTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type RunState = (typeof PROVISIONING_RUN_STATES)[number];

export const TERMINAL_RUN_STATES = new Set<RunState>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export type TimelineArtifact = {
  id: string;
  title: string;
  type?: "manifest" | "terraform" | "plan" | "policy_report" | "cost_report" | "diagram" | "log";
  url?: string;
};

export type TimelineStep = {
  id: string;
  name: string;
  description?: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  artifacts?: TimelineArtifact[];
};

export type ExecutionTimeline = {
  runId?: string;
  currentStep: string;
  steps: TimelineStep[];
};

export type RunTransition = {
  state: RunState;
  at: string;
};

export type TimelineRunInput = {
  id?: string;
  state: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  manifestVersion?: number | null;
};

type StageDefinition = {
  id: string;
  label: string;
  description: string;
  states: readonly RunState[];
  /** Stages the run may pass over entirely (no transition into them). */
  optional?: boolean;
};

/** Ordered PRD §9 stages. FAILED/CANCELLED are not stages; they fail/cancel the farthest reached one. */
const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { id: "received", label: "Request received", description: "Run accepted by the orchestrator.", states: ["RECEIVED"] },
  { id: "policy_requirements", label: "Policy requirements", description: "Workspace policy requirements loaded.", states: ["POLICY_LOADED"] },
  { id: "cloud_context", label: "Cloud context", description: "Connected accounts, regions, and existing resources loaded.", states: ["CLOUD_CONTEXT_LOADED"] },
  { id: "clarification", label: "Clarification", description: "Questions answered so the manifest can be drafted.", states: ["CLARIFYING"], optional: true },
  { id: "manifest", label: "Manifest drafted", description: "Resource manifest created from the request.", states: ["MANIFEST_CREATING"] },
  { id: "manifest_validation", label: "Manifest validated", description: "Manifest validated and confirmed by the requester.", states: ["MANIFEST_VALIDATING"] },
  { id: "iac", label: "IaC generated", description: "Terraform generated from the confirmed manifest.", states: ["IAC_GENERATING"] },
  { id: "plan", label: "Plan created", description: "Terraform plan produced for review.", states: ["PLAN_CREATING"] },
  { id: "policy_check", label: "Policy check", description: "Plan evaluated against workspace policy.", states: ["POLICY_CHECKING"] },
  { id: "confirmation", label: "Confirmation", description: "Requester confirmed the plan before execution.", states: ["CONFIRMING"] },
  { id: "approval", label: "Approval", description: "Workspace approval granted where required.", states: ["APPROVING"], optional: true },
  { id: "execution", label: "Executing", description: "IaC applied to the cloud account.", states: ["EXECUTING"] },
  { id: "completed", label: "Completed", description: "Run finished and cloud state synced.", states: ["COMPLETED"] },
];

const STAGE_FOR_STATE = new Map<RunState, number>();
for (const [index, stage] of STAGE_DEFINITIONS.entries()) {
  for (const state of stage.states) {
    STAGE_FOR_STATE.set(state, index);
  }
}

function isRunState(value: string): value is RunState {
  return (PROVISIONING_RUN_STATES as readonly string[]).includes(value);
}

/** True when the value is a known orchestrator FSM state. */
export function isKnownRunState(value: string): value is RunState {
  return isRunState(value);
}

/** Index in STAGE_DEFINITIONS, or null for FAILED/CANCELLED/unknown states. */
export function stageIndexForState(state: string): number | null {
  return isRunState(state) ? STAGE_FOR_STATE.get(state) ?? null : null;
}

/**
 * Appends an observed transition immutably. `at` should come from the event
 * payload when it carries one (occurred_at) and otherwise is receipt time.
 */
export function appendRunTransition(
  transitions: readonly RunTransition[],
  state: string,
  at: string,
): RunTransition[] {
  if (!isRunState(state)) {
    return [...transitions];
  }
  return [...transitions, { state, at }];
}

/**
 * The farthest stage the run actually reached. Derived from observed
 * transitions; when none were observed (cold reload) it falls back to the
 * current state itself, or to the first stage for terminal states.
 */
function farthestStageIndex(
  run: TimelineRunInput,
  ordered: readonly RunTransition[],
): number {
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const stageIndex = stageIndexForState(ordered[index]!.state);
    if (stageIndex !== null) {
      return stageIndex;
    }
  }
  const direct = stageIndexForState(run.state);
  if (direct !== null) {
    return direct;
  }
  // FAILED/CANCELLED without observed transitions: nothing is known beyond
  // the run having started.
  return 0;
}

function currentStageIndex(run: TimelineRunInput, ordered: readonly RunTransition[]): number {
  if (run.state === "FAILED" || run.state === "CANCELLED") {
    return farthestStageIndex(run, ordered);
  }
  const direct = stageIndexForState(run.state);
  return direct ?? farthestStageIndex(run, ordered);
}

export type BuildTimelineInput = {
  run: TimelineRunInput;
  transitions?: readonly RunTransition[];
  /** Extra artifacts to attach per stage id (merged after derivation). */
  artifactsByStage?: Record<string, TimelineArtifact[]>;
};

function derivedArtifacts(run: TimelineRunInput): Record<string, TimelineArtifact[]> {
  if (typeof run.manifestVersion !== "number" || run.manifestVersion < 1) {
    return {};
  }
  const version = run.manifestVersion;
  return {
    manifest: [{ id: `manifest-v${version}`, title: `Manifest v${version}`, type: "manifest" }],
  };
}

/**
 * Projects a run plus observed transitions into timeline steps. Timestamps are
 * only emitted when actually known; durations require both ends. We never
 * fabricate intermediate timings for a cold reload.
 */
export function buildTimeline({
  run,
  transitions = [],
  artifactsByStage,
}: BuildTimelineInput): ExecutionTimeline {
  const ordered = [...transitions].sort((a, b) => a.at.localeCompare(b.at));
  const observedStages = new Set<number>();
  const startedAt = new Map<number, string>();
  const completedAt = new Map<number, string>();

  // Seed: the run row gives us the true start (and true end once terminal).
  if (run.createdAt) {
    startedAt.set(0, run.createdAt);
  }
  if (run.state === "COMPLETED" || run.state === "FAILED" || run.state === "CANCELLED") {
    const end = run.completedAt ?? run.updatedAt;
    if (end) {
      completedAt.set(farthestStageIndex(run, ordered), end);
    }
  }

  let previousStage: number | null = null;
  for (const transition of ordered) {
    const stageIndex = stageIndexForState(transition.state);
    if (stageIndex === null) {
      continue;
    }
    observedStages.add(stageIndex);
    if (!startedAt.has(stageIndex)) {
      startedAt.set(stageIndex, transition.at);
    }
    // Entering a new stage closes the previous one at the same instant.
    if (previousStage !== null && previousStage !== stageIndex && !completedAt.has(previousStage)) {
      completedAt.set(previousStage, transition.at);
    }
    previousStage = stageIndex;
  }

  const currentIndex = currentStageIndex(run, ordered);
  const derived = derivedArtifacts(run);

  const steps: TimelineStep[] = STAGE_DEFINITIONS.map((stage, index) => {
    const start = startedAt.get(index);
    const end = completedAt.get(index);
    const artifacts = [
      ...(derived[stage.id] ?? []),
      ...(artifactsByStage?.[stage.id] ?? []),
    ];

    let status: TimelineStep["status"];
    if (run.state === "FAILED" && index === currentIndex) {
      status = "failed";
    } else if (run.state === "CANCELLED" && index === currentIndex) {
      status = "cancelled";
    } else if (run.state === "COMPLETED" && index === currentIndex) {
      status = "succeeded";
    } else if (stage.states.includes(run.state as RunState)) {
      status = "running";
    } else if (index < currentIndex) {
      status = stage.optional && !observedStages.has(index) ? "skipped" : "succeeded";
    } else {
      status = "pending";
    }

    return {
      id: stage.id,
      name: stage.label,
      description: stage.description,
      status,
      ...(start !== undefined ? { startedAt: start } : {}),
      ...(end !== undefined ? { completedAt: end } : {}),
      ...(start !== undefined && end !== undefined
        ? { durationMs: Math.max(0, Date.parse(end) - Date.parse(start)) }
        : {}),
      ...(artifacts.length > 0 ? { artifacts } : {}),
    };
  });

  return {
    ...(run.id ? { runId: run.id } : {}),
    currentStep: STAGE_DEFINITIONS[currentIndex]?.label ?? run.state,
    steps,
  };
}

/** Deterministic UTC time-of-day display for a step timestamp. */
export function formatStageTime(iso: string): string {
  return iso.slice(11, 19);
}
