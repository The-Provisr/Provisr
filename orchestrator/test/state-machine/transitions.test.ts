import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  EMPTY_TRANSITION_CONDITIONS,
  IllegalWorkflowTransitionError,
  TransitionConditions,
  UnsatisfiedWorkflowGateError,
} from "../../src/state-machine/transitions";
import { WORKFLOW_STATES, WorkflowState } from "../../src/state-machine/workflow-state";

const allConditions: TransitionConditions = {
  ...EMPTY_TRANSITION_CONDITIONS,
  policiesEnabled: true,
  policyRequirementsLoaded: true,
  cloudContextLoaded: true,
  clarificationCompleted: true,
  manifestCreated: true,
  manifestValidationPassed: true,
  iacGenerated: true,
  planCreated: true,
  policyCheckPassed: true,
  confirmationCompleted: true,
  approvalRequired: true,
  approvalCompleted: true,
};

describe("OR-006 strict workflow transition map", () => {
  it("defines a transition list for every PRD workflow state", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS)).toEqual(WORKFLOW_STATES);
  });

  it("accepts every explicitly valid transition", () => {
    for (const from of WORKFLOW_STATES) {
      for (const transition of ALLOWED_TRANSITIONS[from]) {
        expect(() => assertTransition(from, transition.to, allConditions)).not.toThrow();
      }
    }
  });

  it("rejects every non-listed transition", () => {
    for (const from of WORKFLOW_STATES) {
      const allowed = new Set(ALLOWED_TRANSITIONS[from].map((transition) => transition.to));
      for (const to of WORKFLOW_STATES) {
        if (!allowed.has(to)) {
          expect(() => assertTransition(from, to, allConditions)).toThrow(IllegalWorkflowTransitionError);
        }
      }
    }
  });

  it("blocks policy-enabled manifests until requirements are loaded", () => {
    expect(() =>
      assertTransition("CLOUD_CONTEXT_LOADED", "MANIFEST_CREATING", {
        ...allConditions,
        policyRequirementsLoaded: false,
      }),
    ).toThrow(UnsatisfiedWorkflowGateError);
  });

  it("allows a policy-disabled run to skip POLICY_LOADED with an auditable direct path", () => {
    expect(() =>
      assertTransition("RECEIVED", "CLOUD_CONTEXT_LOADED", {
        ...EMPTY_TRANSITION_CONDITIONS,
        cloudContextLoaded: true,
      }),
    ).not.toThrow();
  });

  it("blocks IaC generation until manifest validation passed", () => {
    expect(() =>
      assertTransition("MANIFEST_VALIDATING", "IAC_GENERATING", {
        ...allConditions,
        manifestValidationPassed: false,
      }),
    ).toThrow(UnsatisfiedWorkflowGateError);
  });

  it("blocks execution until confirmation, policy check, and any required approval are complete", () => {
    const combinations: Array<Partial<TransitionConditions>> = [
      { confirmationCompleted: false },
      { policyCheckPassed: false },
      { approvalRequired: true, approvalCompleted: false },
    ];
    for (const override of combinations) {
      expect(() => assertTransition("APPROVING", "EXECUTING", { ...allConditions, ...override })).toThrow(
        UnsatisfiedWorkflowGateError,
      );
    }
  });

  it("keeps terminal states terminal", () => {
    for (const state of ["COMPLETED", "FAILED", "CANCELLED"] as WorkflowState[]) {
      expect(ALLOWED_TRANSITIONS[state]).toEqual([]);
    }
  });
});
