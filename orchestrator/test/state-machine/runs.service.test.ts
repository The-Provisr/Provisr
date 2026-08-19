import { describe, expect, it, vi } from "vitest";
import { RunsService, createRunsService } from "../../src/state-machine/runs.service";
import type { DbService } from "../../src/db/db.service";

describe("RunsService", () => {
  const workspaceId = "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a";
  const runId = "b3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6b";
  const userId = "user-1";

  const mockRun = {
    id: runId,
    sessionId: "s1",
    workspaceId,
    requesterId: userId,
    state: "received",
    stateVersion: 0,
    prompt: "Deploy Postgres",
    manifestVersion: null,
    policyDecision: null,
    approvalStatus: "not_required",
    executionStatus: "pending",
    idempotencyKey: "key-1",
    correlationId: "corr-1",
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  };

  it("creates service via factory function", () => {
    const db = {} as DbService;
    const service = createRunsService(db);
    expect(service).toBeInstanceOf(RunsService);
  });

  it("confirms run by transitioning state to pending_approval", async () => {
    const service = new RunsService({} as DbService);
    service.getRun = vi.fn().mockResolvedValue(mockRun);
    service.transitionState = vi.fn().mockResolvedValue({ ...mockRun, state: "pending_approval" });

    const result = await service.confirmRun(runId, workspaceId, userId, {
      manifestVersion: "v1",
      planVersion: "v1",
    });

    expect(service.getRun).toHaveBeenCalledWith(runId, workspaceId);
    expect(service.transitionState).toHaveBeenCalledWith(
      runId,
      workspaceId,
      0,
      "pending_approval",
      userId,
    );
    expect(result.state).toBe("pending_approval");
  });

  it("clarifies run by transitioning state to pending_agent", async () => {
    const service = new RunsService({} as DbService);
    service.getRun = vi.fn().mockResolvedValue({ ...mockRun, state: "pending_clarification" });
    service.transitionState = vi.fn().mockResolvedValue({ ...mockRun, state: "pending_agent" });

    const result = await service.clarifyRun(runId, workspaceId, userId, {
      answers: { region: "us-east-1" },
    });

    expect(service.getRun).toHaveBeenCalledWith(runId, workspaceId);
    expect(service.transitionState).toHaveBeenCalledWith(
      runId,
      workspaceId,
      0,
      "pending_agent",
      userId,
    );
    expect(result.state).toBe("pending_agent");
  });

  it("cancels active run", async () => {
    const service = new RunsService({} as DbService);
    service.getRun = vi.fn().mockResolvedValue(mockRun);
    service.transitionState = vi.fn().mockResolvedValue({ ...mockRun, state: "cancelled" });

    const result = await service.cancelRun(runId, workspaceId, userId);

    expect(service.getRun).toHaveBeenCalledWith(runId, workspaceId);
    expect(service.transitionState).toHaveBeenCalledWith(
      runId,
      workspaceId,
      0,
      "cancelled",
      userId,
    );
    expect(result.state).toBe("cancelled");
  });

  it("does not re-cancel already completed, failed, or cancelled run", async () => {
    const service = new RunsService({} as DbService);
    service.getRun = vi.fn().mockResolvedValue({ ...mockRun, state: "completed" });
    service.transitionState = vi.fn();

    const result = await service.cancelRun(runId, workspaceId, userId);

    expect(service.getRun).toHaveBeenCalledWith(runId, workspaceId);
    expect(service.transitionState).not.toHaveBeenCalled();
    expect(result.state).toBe("completed");
  });

  it("creates run atomically with audit log in one transaction", async () => {
    const executedQueries: string[] = [];
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("INSERT INTO provisr_state.provisioning_runs")) {
          return { rows: [mockRun] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn(),
    } as unknown as DbService;

    const service = new RunsService(db);
    const result = await service.createRun("s1", workspaceId, userId, "Deploy Postgres");

    expect(result.id).toBe(runId);
    expect(executedQueries[0]).toBe("BEGIN");
    expect(executedQueries[1]).toContain("INSERT INTO provisr_state.provisioning_runs");
    expect(executedQueries[2]).toContain("INSERT INTO provisr_audit.audit_events");
    expect(executedQueries[3]).toBe("COMMIT");
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and propagates error if audit log insert fails during run creation", async () => {
    const executedQueries: string[] = [];
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("INSERT INTO provisr_state.provisioning_runs")) {
          return { rows: [mockRun] };
        }
        if (sql.includes("INSERT INTO provisr_audit.audit_events")) {
          throw new Error("Audit insert failure");
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn(),
    } as unknown as DbService;

    const service = new RunsService(db);
    await expect(
      service.createRun("s1", workspaceId, userId, "Deploy Postgres"),
    ).rejects.toThrow("Audit insert failure");

    expect(executedQueries[0]).toBe("BEGIN");
    expect(executedQueries[1]).toContain("INSERT INTO provisr_state.provisioning_runs");
    expect(executedQueries[2]).toContain("INSERT INTO provisr_audit.audit_events");
    expect(executedQueries[3]).toBe("ROLLBACK");
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });
});
