import { describe, expect, it } from "vitest";
import {
  ConcurrentWorkflowTransitionError,
  ProvisioningRunSnapshot,
  WorkflowTransitionService,
  WorkflowTransitionStore,
} from "../../src/state-machine/workflow-transition.service";
import { EMPTY_TRANSITION_CONDITIONS } from "../../src/state-machine/transitions";

const run: ProvisioningRunSnapshot = {
  id: "run-1",
  workspaceId: "workspace-1",
  state: "RECEIVED",
  stateVersion: 4,
  correlationId: "correlation-1",
};

describe("OR-006 transition persistence contract", () => {
  it("increments the version and supplies audit plus StateChangedEvent to one atomic store call", async () => {
    const calls: Parameters<WorkflowTransitionStore["transitionAtomically"]>[0][] = [];
    const store: WorkflowTransitionStore = {
      async transitionAtomically(input) {
        calls.push(input);
        return { ...run, state: input.nextState, stateVersion: input.expectedStateVersion + 1 };
      },
    };
    const service = new WorkflowTransitionService(store);
    const result = await service.transition({
      run,
      to: "CLOUD_CONTEXT_LOADED",
      conditions: { ...EMPTY_TRANSITION_CONDITIONS, cloudContextLoaded: true },
      actorId: "user-1",
      actorType: "user",
      now: new Date("2026-08-13T09:00:00.000Z"),
    });

    expect(result.run.stateVersion).toBe(5);
    expect(result.event).toMatchObject({
      type: "StateChangedEvent",
      from: "RECEIVED",
      to: "CLOUD_CONTEXT_LOADED",
      stateVersion: 5,
      occurredAt: "2026-08-13T09:00:00.000Z",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      expectedState: "RECEIVED",
      expectedStateVersion: 4,
      nextState: "CLOUD_CONTEXT_LOADED",
      audit: { from: "RECEIVED", to: "CLOUD_CONTEXT_LOADED", stateVersion: 5 },
    });
  });

  it("reports an optimistic-lock conflict when the atomic compare-and-set fails", async () => {
    const service = new WorkflowTransitionService({
      async transitionAtomically() {
        return null;
      },
    });

    await expect(
      service.transition({
        run,
        to: "CLOUD_CONTEXT_LOADED",
        conditions: { ...EMPTY_TRANSITION_CONDITIONS, cloudContextLoaded: true },
        actorId: "user-1",
        actorType: "user",
      }),
    ).rejects.toThrow(ConcurrentWorkflowTransitionError);
  });
});
