/**
 * Canonical provisioning workflow states from PRD §9.
 *
 * These values intentionally do not mirror UI request-status labels. They are
 * the control-plane states used to decide whether a side effect is permitted.
 */
export const WORKFLOW_STATES = [
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

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const TERMINAL_WORKFLOW_STATES = new Set<WorkflowState>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export function isTerminalWorkflowState(state: WorkflowState): boolean {
  return TERMINAL_WORKFLOW_STATES.has(state);
}
