import { WorkflowState } from "./workflow-state";

/** Side effects are owned by the orchestrator, never by an agent. */
export type EntryAction =
  | "NONE"
  | "LOAD_POLICY_REQUIREMENTS"
  | "LOAD_CLOUD_CONTEXT"
  | "REQUEST_CLARIFICATION"
  | "CREATE_MANIFEST"
  | "VALIDATE_MANIFEST"
  | "GENERATE_IAC"
  | "CREATE_PLAN"
  | "CHECK_POLICY"
  | "REQUEST_CONFIRMATION"
  | "REQUEST_APPROVAL"
  | "EXECUTE_IAC"
  | "PUBLISH_COMPLETION";

export interface TransitionConditions {
  policiesEnabled: boolean;
  policyRequirementsLoaded: boolean;
  cloudContextLoaded: boolean;
  clarificationCompleted: boolean;
  manifestCreated: boolean;
  manifestValidationPassed: boolean;
  iacGenerated: boolean;
  planCreated: boolean;
  policyCheckPassed: boolean;
  confirmationCompleted: boolean;
  approvalRequired: boolean;
  approvalCompleted: boolean;
}

export const EMPTY_TRANSITION_CONDITIONS: TransitionConditions = {
  policiesEnabled: false,
  policyRequirementsLoaded: false,
  cloudContextLoaded: false,
  clarificationCompleted: false,
  manifestCreated: false,
  manifestValidationPassed: false,
  iacGenerated: false,
  planCreated: false,
  policyCheckPassed: false,
  confirmationCompleted: false,
  approvalRequired: false,
  approvalCompleted: false,
};

export interface TransitionDefinition {
  readonly to: WorkflowState;
  readonly onEntry: EntryAction;
  readonly requiredConditions: readonly (keyof TransitionConditions)[];
}

const EXIT_TO_FAILURE_OR_CANCELLATION: readonly TransitionDefinition[] = [
  { to: "FAILED", onEntry: "NONE", requiredConditions: [] },
  { to: "CANCELLED", onEntry: "NONE", requiredConditions: [] },
];

/**
 * The only legal state changes. Keeping this as data lets tests exhaustively
 * verify the flow and makes the required conditions visible to reviewers.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<WorkflowState, readonly TransitionDefinition[]>> = {
  RECEIVED: [
    { to: "POLICY_LOADED", onEntry: "LOAD_POLICY_REQUIREMENTS", requiredConditions: [] },
    { to: "CLOUD_CONTEXT_LOADED", onEntry: "LOAD_CLOUD_CONTEXT", requiredConditions: [] },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  POLICY_LOADED: [
    {
      to: "CLOUD_CONTEXT_LOADED",
      onEntry: "LOAD_CLOUD_CONTEXT",
      requiredConditions: ["policyRequirementsLoaded"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  CLOUD_CONTEXT_LOADED: [
    {
      to: "CLARIFYING",
      onEntry: "REQUEST_CLARIFICATION",
      requiredConditions: ["cloudContextLoaded"],
    },
    {
      to: "MANIFEST_CREATING",
      onEntry: "CREATE_MANIFEST",
      requiredConditions: ["cloudContextLoaded"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  CLARIFYING: [
    {
      to: "CLARIFYING",
      onEntry: "REQUEST_CLARIFICATION",
      requiredConditions: [],
    },
    {
      to: "MANIFEST_CREATING",
      onEntry: "CREATE_MANIFEST",
      requiredConditions: ["cloudContextLoaded", "clarificationCompleted"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  MANIFEST_CREATING: [
    {
      to: "MANIFEST_VALIDATING",
      onEntry: "VALIDATE_MANIFEST",
      requiredConditions: ["manifestCreated"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  MANIFEST_VALIDATING: [
    {
      to: "IAC_GENERATING",
      onEntry: "GENERATE_IAC",
      requiredConditions: ["manifestValidationPassed"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  IAC_GENERATING: [
    {
      to: "PLAN_CREATING",
      onEntry: "CREATE_PLAN",
      requiredConditions: ["iacGenerated"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  PLAN_CREATING: [
    {
      to: "POLICY_CHECKING",
      onEntry: "CHECK_POLICY",
      requiredConditions: ["planCreated"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  POLICY_CHECKING: [
    {
      to: "CONFIRMING",
      onEntry: "REQUEST_CONFIRMATION",
      requiredConditions: ["policyCheckPassed"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  CONFIRMING: [
    {
      to: "APPROVING",
      onEntry: "REQUEST_APPROVAL",
      requiredConditions: ["confirmationCompleted", "approvalRequired"],
    },
    {
      to: "EXECUTING",
      onEntry: "EXECUTE_IAC",
      requiredConditions: ["confirmationCompleted"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  APPROVING: [
    {
      to: "EXECUTING",
      onEntry: "EXECUTE_IAC",
      requiredConditions: ["confirmationCompleted", "approvalRequired", "approvalCompleted"],
    },
    ...EXIT_TO_FAILURE_OR_CANCELLATION,
  ],
  EXECUTING: [
    { to: "COMPLETED", onEntry: "PUBLISH_COMPLETION", requiredConditions: [] },
    { to: "FAILED", onEntry: "NONE", requiredConditions: [] },
  ],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export class IllegalWorkflowTransitionError extends Error {
  constructor(readonly from: WorkflowState, readonly to: WorkflowState) {
    super(`Illegal workflow transition: ${from} -> ${to}`);
  }
}

export class UnsatisfiedWorkflowGateError extends Error {
  constructor(
    readonly from: WorkflowState,
    readonly to: WorkflowState,
    readonly missing: readonly (keyof TransitionConditions)[],
  ) {
    super(`Workflow transition ${from} -> ${to} is blocked by: ${missing.join(", ")}`);
  }
}

export function getTransition(from: WorkflowState, to: WorkflowState): TransitionDefinition {
  const transition = ALLOWED_TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (!transition) throw new IllegalWorkflowTransitionError(from, to);
  return transition;
}

export function assertTransition(
  from: WorkflowState,
  to: WorkflowState,
  conditions: TransitionConditions,
): TransitionDefinition {
  const transition = getTransition(from, to);
  const missing = transition.requiredConditions.filter((condition) => !conditions[condition]);

  // Policy pre-flight is a hard gate even when a caller accidentally omits it
  // from a transition definition. OR-008 supplies the policy payload itself.
  if (to === "MANIFEST_CREATING" && conditions.policiesEnabled && !conditions.policyRequirementsLoaded) {
    missing.push("policyRequirementsLoaded");
  }
  if (to === "EXECUTING" && !conditions.policyCheckPassed) {
    missing.push("policyCheckPassed");
  }
  if (to === "EXECUTING" && conditions.approvalRequired && !conditions.approvalCompleted) {
    missing.push("approvalCompleted");
  }

  if (missing.length > 0) {
    throw new UnsatisfiedWorkflowGateError(from, to, [...new Set(missing)]);
  }
  return transition;
}
