import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  ALL_RUN_STATES,
  ProvisioningRun,
  RunState,
  RunsService,
} from "../../src/state-machine/runs.service";
import type { DbService } from "../../src/db/db.service";

describe("State Machine Transitions Integration Tests", () => {
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  const runId = randomUUID();
  const userId = randomUUID();

  const createMockRun = (overrides?: Partial<ProvisioningRun>): ProvisioningRun => ({
    id: runId,
    sessionId,
    workspaceId,
    requesterId: userId,
    state: "received",
    stateVersion: 0,
    prompt: "provision vpc and k8s cluster",
    manifestVersion: null,
    policyDecision: null,
    approvalStatus: null,
    executionStatus: null,
    idempotencyKey: null,
    correlationId: randomUUID(),
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  });

  /**
   * Helper that simulates an in-memory transactional database for RunsService
   */
  function createTransactionalMockDb(initialRun: ProvisioningRun) {
    let currentRunState = { ...initialRun };
    const auditLogs: Array<{ action: string; eventData: string }> = [];
    const outboxEvents: Array<{ eventType: string; payload: string }> = [];

    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [] };
        }
        if (sql.includes("FROM provisr_state.provisioning_runs") && sql.includes("FOR UPDATE")) {
          const [id, wsId] = params as [string, string];
          if (id === currentRunState.id && wsId === currentRunState.workspaceId) {
            return { rows: [{ ...currentRunState }] };
          }
          return { rows: [] };
        }
        if (sql.includes("UPDATE provisr_state.provisioning_runs")) {
          const [newState, id, wsId, expectedVer] = params as [RunState, string, string, number];
          if (
            id === currentRunState.id &&
            wsId === currentRunState.workspaceId &&
            currentRunState.stateVersion === expectedVer
          ) {
            currentRunState = {
              ...currentRunState,
              state: newState,
              stateVersion: currentRunState.stateVersion + 1,
              updatedAt: new Date(),
            };
            return { rows: [{ ...currentRunState }] };
          }
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO provisr_audit.audit_events")) {
          const [wsId, actorId, rId, eventData] = params as [string, string, string, string];
          auditLogs.push({ action: "run_transitioned", eventData, workspaceId: wsId, actorId, resourceId: rId });
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO provisr_events.events")) {
          const [eventId, rId, payload] = params as [string, string, string];
          outboxEvents.push({ eventId, resourceId: rId, eventType: "StateChangedEvent", payload });
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM provisr_state.provisioning_runs")) {
          const [id, wsId] = params as [string, string];
          if (id === currentRunState.id && wsId === currentRunState.workspaceId) {
            return { rows: [{ ...currentRunState }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      }),
    } as unknown as DbService;

    return {
      db,
      poolClient,
      getRunState: () => currentRunState,
      setRunState: (updated: ProvisioningRun) => {
        currentRunState = { ...updated };
      },
      getAuditLogs: () => auditLogs,
      getOutboxEvents: () => outboxEvents,
    };
  }

  describe("End-to-End Strict State Transition Sequence", () => {
    it("successfully progresses through all prescribed stages from received to completed", async () => {
      const initial = createMockRun();
      const mockEnv = createTransactionalMockDb(initial);
      const service = new RunsService(mockEnv.db);

      const happyPathTransitions: RunState[] = [
        "pending_policy",
        "pending_cloud_context",
        "pending_agent",
        "manifest_ready",
        "pending_iac",
        "plan_ready",
        "pending_policy_check",
        "pending_confirmation",
        "pending_approval",
        "pending_execution",
        "executing",
        "completed",
      ];

      let currentExpectedVersion = 0;

      for (const nextState of happyPathTransitions) {
        const updated = await service.transitionState(
          runId,
          workspaceId,
          currentExpectedVersion,
          nextState,
          userId,
        );

        expect(updated.state).toBe(nextState);
        currentExpectedVersion += 1;
        expect(updated.stateVersion).toBe(currentExpectedVersion);
      }

      expect(mockEnv.getRunState().state).toBe("completed");
      expect(mockEnv.getRunState().stateVersion).toBe(12);

      // Verify audit events and outbox events captured at each transition
      const auditLogs = mockEnv.getAuditLogs();
      expect(auditLogs).toHaveLength(12);
      expect(auditLogs.every((log) => log.action === "run_transitioned")).toBe(true);

      const outboxEvents = mockEnv.getOutboxEvents();
      expect(outboxEvents).toHaveLength(12);
      expect(outboxEvents.every((e) => e.eventType === "StateChangedEvent")).toBe(true);
    });
  });

  describe("Approval Edge Cases & Gating", () => {
    it("successfully approves a run in pending_approval state -> moves to pending_execution", async () => {
      const initial = createMockRun({ state: "pending_approval", stateVersion: 8 });
      const mockEnv = createTransactionalMockDb(initial);
      const service = new RunsService(mockEnv.db);

      const result = await service.decideApproval(runId, workspaceId, userId, {
        decision: "approved",
      });

      expect(result.state).toBe("pending_execution");
      expect(result.stateVersion).toBe(9);
    });

    it("successfully rejects a run in pending_approval state -> moves to pending_agent for redesign", async () => {
      const initial = createMockRun({ state: "pending_approval", stateVersion: 8 });
      const mockEnv = createTransactionalMockDb(initial);
      const service = new RunsService(mockEnv.db);

      const result = await service.decideApproval(runId, workspaceId, userId, {
        decision: "rejected",
        reason: "Cost estimate exceeds monthly budget threshold",
      });

      expect(result.state).toBe("pending_agent");
      expect(result.stateVersion).toBe(9);
    });

    it("rejects approval decision when run is NOT in pending_approval (e.g., in pending_agent / rejected state)", async () => {
      const rejectedRun = createMockRun({ state: "pending_agent", stateVersion: 9 });
      const mockEnv = createTransactionalMockDb(rejectedRun);
      const service = new RunsService(mockEnv.db);

      await expect(
        service.decideApproval(runId, workspaceId, userId, { decision: "approved" }),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.decideApproval(runId, workspaceId, userId, { decision: "approved" }),
      ).rejects.toThrow("Cannot decide approval for run in 'pending_agent' state (expected 'pending_approval')");
    });

    it("rejects approval decision on already completed, failed, or executing runs", async () => {
      const terminalStates: RunState[] = ["completed", "failed", "cancelled", "executing", "received"];

      for (const invalidState of terminalStates) {
        const run = createMockRun({ state: invalidState, stateVersion: 5 });
        const mockEnv = createTransactionalMockDb(run);
        const service = new RunsService(mockEnv.db);

        await expect(
          service.decideApproval(runId, workspaceId, userId, { decision: "approved" }),
        ).rejects.toThrow(`Cannot decide approval for run in '${invalidState}' state (expected 'pending_approval')`);
      }
    });

    it("rejects direct state transition to pending_execution from non-approval states", async () => {
      const nonApprovalStates: RunState[] = [
        "received",
        "pending_policy",
        "pending_cloud_context",
        "pending_agent",
        "manifest_ready",
        "pending_iac",
        "plan_ready",
        "pending_policy_check",
        "pending_confirmation",
        "executing",
        "completed",
        "failed",
        "cancelled",
      ];

      for (const fromState of nonApprovalStates) {
        const run = createMockRun({ state: fromState, stateVersion: 2 });
        const mockEnv = createTransactionalMockDb(run);
        const service = new RunsService(mockEnv.db);

        await expect(
          service.transitionState(runId, workspaceId, 2, "pending_execution", userId),
        ).rejects.toThrow(
          `Invalid state transition from '${fromState}' to 'pending_execution'`,
        );
      }
    });
  });

  describe("Enforce Strict Step Order (Rejection of Skipped Transitions)", () => {
    it("rejects jumping directly from received to executing (bypassing all safety gates)", async () => {
      const initial = createMockRun({ state: "received", stateVersion: 0 });
      const mockEnv = createTransactionalMockDb(initial);
      const service = new RunsService(mockEnv.db);

      await expect(
        service.transitionState(runId, workspaceId, 0, "executing", userId),
      ).rejects.toThrow("Invalid state transition from 'received' to 'executing'");
    });

    it("rejects jumping from manifest_ready to executing (bypassing IaC, Plan, Policy, Confirmation, Approval)", async () => {
      const initial = createMockRun({ state: "manifest_ready", stateVersion: 4 });
      const mockEnv = createTransactionalMockDb(initial);
      const service = new RunsService(mockEnv.db);

      await expect(
        service.transitionState(runId, workspaceId, 4, "executing", userId),
      ).rejects.toThrow("Invalid state transition from 'manifest_ready' to 'executing'");
    });

    it("rejects jumping from pending_confirmation to executing (bypassing approval gate)", async () => {
      const initial = createMockRun({ state: "pending_confirmation", stateVersion: 8 });
      const mockEnv = createTransactionalMockDb(initial);
      const service = new RunsService(mockEnv.db);

      await expect(
        service.transitionState(runId, workspaceId, 8, "executing", userId),
      ).rejects.toThrow("Invalid state transition from 'pending_confirmation' to 'executing'");
    });

    it("rejects jumping from pending_execution to completed (bypassing execution)", async () => {
      const initial = createMockRun({ state: "pending_execution", stateVersion: 10 });
      const mockEnv = createTransactionalMockDb(initial);
      const service = new RunsService(mockEnv.db);

      await expect(
        service.transitionState(runId, workspaceId, 10, "completed", userId),
      ).rejects.toThrow("Invalid state transition from 'pending_execution' to 'completed'");
    });
  });

  describe("Rejection of Backward and Terminal Transitions", () => {
    it("rejects backward transitions from executing to previous states", async () => {
      const executingRun = createMockRun({ state: "executing", stateVersion: 11 });
      const mockEnv = createTransactionalMockDb(executingRun);
      const service = new RunsService(mockEnv.db);

      const previousStates: RunState[] = [
        "received",
        "pending_policy",
        "pending_cloud_context",
        "pending_agent",
        "manifest_ready",
        "pending_iac",
        "plan_ready",
        "pending_policy_check",
        "pending_confirmation",
        "pending_approval",
        "pending_execution",
      ];

      for (const backwardState of previousStates) {
        await expect(
          service.transitionState(runId, workspaceId, 11, backwardState, userId),
        ).rejects.toThrow(`Invalid state transition from 'executing' to '${backwardState}'`);
      }
    });

    it("rejects any transitions out of terminal states (completed, failed, cancelled)", async () => {
      const terminalStates: RunState[] = ["completed", "failed", "cancelled"];

      for (const terminal of terminalStates) {
        const run = createMockRun({ state: terminal, stateVersion: 12 });
        const mockEnv = createTransactionalMockDb(run);
        const service = new RunsService(mockEnv.db);

        for (const targetState of ALL_RUN_STATES) {
          await expect(
            service.transitionState(runId, workspaceId, 12, targetState, userId),
          ).rejects.toThrow(`Invalid state transition from '${terminal}' to '${targetState}'`);
        }
      }
    });
  });

  describe("Optimistic Concurrency & Version Conflicts", () => {
    it("rejects state transitions when expectedVersion does not match current stateVersion", async () => {
      const run = createMockRun({ state: "pending_agent", stateVersion: 3 });
      const mockEnv = createTransactionalMockDb(run);
      const service = new RunsService(mockEnv.db);

      // Stale expectedVersion = 2 (actual is 3)
      await expect(
        service.transitionState(runId, workspaceId, 2, "manifest_ready", userId),
      ).rejects.toThrow("State version conflict");

      // Future expectedVersion = 4 (actual is 3)
      await expect(
        service.transitionState(runId, workspaceId, 4, "manifest_ready", userId),
      ).rejects.toThrow("State version conflict");
    });

    it("throws NotFoundException if run does not exist", async () => {
      const run = createMockRun();
      const mockEnv = createTransactionalMockDb(run);
      const service = new RunsService(mockEnv.db);

      await expect(
        service.transitionState(randomUUID(), workspaceId, 0, "pending_policy", userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("Cancellation Transitions", () => {
    it("allows cancellation from all non-terminal states", async () => {
      const nonTerminalStates: RunState[] = [
        "received",
        "pending_policy",
        "pending_cloud_context",
        "pending_agent",
        "manifest_ready",
        "pending_iac",
        "plan_ready",
        "pending_policy_check",
        "pending_confirmation",
        "pending_approval",
        "pending_execution",
        "executing",
      ];

      for (let i = 0; i < nonTerminalStates.length; i++) {
        const state = nonTerminalStates[i];
        const run = createMockRun({ id: randomUUID(), state, stateVersion: i });
        const mockEnv = createTransactionalMockDb(run);
        const service = new RunsService(mockEnv.db);

        const cancelled = await service.cancelRun(run.id, workspaceId, userId);
        expect(cancelled.state).toBe("cancelled");
        expect(cancelled.stateVersion).toBe(i + 1);
      }
    });

    it("is idempotent when canceling an already cancelled, completed, or failed run", async () => {
      const terminalStates: RunState[] = ["cancelled", "completed", "failed"];

      for (const terminal of terminalStates) {
        const run = createMockRun({ id: randomUUID(), state: terminal, stateVersion: 5 });
        const mockEnv = createTransactionalMockDb(run);
        const service = new RunsService(mockEnv.db);

        const result = await service.cancelRun(run.id, workspaceId, userId);
        expect(result.state).toBe(terminal);
        expect(result.stateVersion).toBe(5);
      }
    });
  });

  describe("Clarification and Re-prompt Loops", () => {
    it("allows transitioning from pending_agent to pending_agent when user clarifies input", async () => {
      const run = createMockRun({ state: "pending_agent", stateVersion: 3 });
      const mockEnv = createTransactionalMockDb(run);
      const service = new RunsService(mockEnv.db);

      const clarified = await service.clarifyRun(runId, workspaceId, userId, {
        answers: { databaseEngine: "postgresql", size: "medium" },
      });

      expect(clarified.state).toBe("pending_agent");
      expect(clarified.stateVersion).toBe(4);
    });

    it("allows re-planning transitions to pending_agent from policy_check, confirmation, and approval", async () => {
      const rePlanSources: RunState[] = [
        "pending_policy_check",
        "pending_confirmation",
        "pending_approval",
      ];

      for (let i = 0; i < rePlanSources.length; i++) {
        const sourceState = rePlanSources[i];
        const run = createMockRun({ id: randomUUID(), state: sourceState, stateVersion: 5 + i });
        const mockEnv = createTransactionalMockDb(run);
        const service = new RunsService(mockEnv.db);

        const updated = await service.transitionState(
          run.id,
          workspaceId,
          run.stateVersion,
          "pending_agent",
          userId,
        );

        expect(updated.state).toBe("pending_agent");
        expect(updated.stateVersion).toBe(run.stateVersion + 1);
      }
    });
  });
});
