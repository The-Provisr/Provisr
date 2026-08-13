import { randomUUID } from "node:crypto";
import { assertTransition, EntryAction, TransitionConditions } from "./transitions";
import { WorkflowState } from "./workflow-state";

export interface ProvisioningRunSnapshot {
  id: string;
  workspaceId: string;
  state: WorkflowState;
  stateVersion: number;
  correlationId: string;
}

export interface StateChangedEvent {
  id: string;
  type: "StateChangedEvent";
  workspaceId: string;
  runId: string;
  correlationId: string;
  from: WorkflowState;
  to: WorkflowState;
  stateVersion: number;
  occurredAt: string;
}

export interface StateTransitionAudit {
  workspaceId: string;
  runId: string;
  actorId: string;
  actorType: "user" | "agent" | "system";
  from: WorkflowState;
  to: WorkflowState;
  stateVersion: number;
}

/**
 * Database adapter boundary. Its transaction must use a compare-and-set
 * update on (id, state, state_version), then append audit + outbox records
 * before committing. This is what prevents a concurrent request from winning.
 */
export interface WorkflowTransitionStore {
  transitionAtomically(input: {
    runId: string;
    expectedState: WorkflowState;
    expectedStateVersion: number;
    nextState: WorkflowState;
    audit: StateTransitionAudit;
    event: StateChangedEvent;
  }): Promise<ProvisioningRunSnapshot | null>;
}

export class ConcurrentWorkflowTransitionError extends Error {
  constructor(readonly runId: string, readonly expectedStateVersion: number) {
    super(`Run ${runId} was modified before state version ${expectedStateVersion} could be transitioned`);
  }
}

export class WorkflowTransitionService {
  constructor(private readonly store: WorkflowTransitionStore) {}

  async transition(input: {
    run: ProvisioningRunSnapshot;
    to: WorkflowState;
    conditions: TransitionConditions;
    actorId: string;
    actorType: "user" | "agent" | "system";
    now?: Date;
  }): Promise<{ run: ProvisioningRunSnapshot; onEntry: EntryAction; event: StateChangedEvent }> {
    const onEntry = assertTransition(input.run.state, input.to, input.conditions).onEntry;
    const nextStateVersion = input.run.stateVersion + 1;
    const event: StateChangedEvent = {
      id: randomUUID(),
      type: "StateChangedEvent",
      workspaceId: input.run.workspaceId,
      runId: input.run.id,
      correlationId: input.run.correlationId,
      from: input.run.state,
      to: input.to,
      stateVersion: nextStateVersion,
      occurredAt: (input.now ?? new Date()).toISOString(),
    };
    const run = await this.store.transitionAtomically({
      runId: input.run.id,
      expectedState: input.run.state,
      expectedStateVersion: input.run.stateVersion,
      nextState: input.to,
      audit: {
        workspaceId: input.run.workspaceId,
        runId: input.run.id,
        actorId: input.actorId,
        actorType: input.actorType,
        from: input.run.state,
        to: input.to,
        stateVersion: nextStateVersion,
      },
      event,
    });
    if (!run) throw new ConcurrentWorkflowTransitionError(input.run.id, input.run.stateVersion);
    return { run, onEntry, event };
  }
}
