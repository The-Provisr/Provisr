import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ChatPersistenceService,
  createChatPersistenceService,
} from "../../src/services/chat-persistence.service";
import type { ChatEventsService } from "../../src/services/chat-events.service";
import type { DbService } from "../../src/db/db.service";
import { ConflictError } from "../../src/common/errors/typed-errors";

describe("ChatPersistenceService", () => {
  const baseParams = {
    sessionId: "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a",
    workspaceId: "b3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6b",
    userId: "user-1",
    prompt: "Create an S3 bucket",
    clientMessageId: "c3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6c",
    idempotencyKey: "idemp-key-123",
  };

  const expectedFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        sessionId: baseParams.sessionId,
        workspaceId: baseParams.workspaceId,
        userId: baseParams.userId,
        prompt: baseParams.prompt,
        clientMessageId: baseParams.clientMessageId,
      }),
    )
    .digest("hex");

  it("creates service instance via factory function", () => {
    const db = {} as DbService;
    const events = {} as ChatEventsService;
    const service = createChatPersistenceService(db, events);
    expect(service).toBeInstanceOf(ChatPersistenceService);
  });

  it("submits planning turn with advisory lock, inserts records and emits event", async () => {
    const executedQueries: string[] = [];
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("SELECT 1 FROM provisr_identity.memberships")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT 1 FROM provisr_state.chat_sessions")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("INSERT INTO provisr_state.provisioning_runs")) {
          return { rows: [{ id: "run-uuid-1" }] };
        }
        if (sql.includes("INSERT INTO provisr_state.chat_turns")) {
          return { rows: [{ id: "turn-uuid-1" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      pool: { query: vi.fn() },
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn(),
    } as unknown as DbService;

    const events = {
      append: vi.fn().mockResolvedValue({ id: "event-1" }),
    } as unknown as ChatEventsService;

    const service = new ChatPersistenceService(db, events);
    const result = await service.submitPlanningTurn(baseParams);

    expect(result).toEqual({ turnId: "turn-uuid-1", runId: "run-uuid-1", replayed: false });
    expect(executedQueries[0]).toBe("BEGIN");
    expect(executedQueries[1]).toContain("provisr_identity.memberships");
    expect(executedQueries[2]).toContain("pg_advisory_xact_lock");
    expect(executedQueries[3]).toContain("SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns");
    expect(executedQueries[4]).toContain("provisr_state.chat_sessions");
    expect(executedQueries[5]).toContain("INSERT INTO provisr_state.provisioning_runs");
    expect(executedQueries[6]).toContain("INSERT INTO provisr_state.chat_turns");
    expect(executedQueries[7]).toContain("INSERT INTO provisr_state.chat_messages");
    expect(events.append).toHaveBeenCalledTimes(1);
    expect(executedQueries[executedQueries.length - 1]).toBe("COMMIT");
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });

  it("replays matching request if turn exists during transaction", async () => {
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT 1 FROM provisr_identity.memberships")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns")) {
          return {
            rows: [
              {
                id: "existing-turn",
                provisioning_run_id: "existing-run",
                request_fingerprint: expectedFingerprint,
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn(),
    } as unknown as DbService;

    const events = {
      append: vi.fn(),
    } as unknown as ChatEventsService;

    const service = new ChatPersistenceService(db, events);
    const result = await service.submitPlanningTurn(baseParams);
    expect(result).toEqual({
      turnId: "existing-turn",
      runId: "existing-run",
      replayed: true,
    });
  });

  it("throws ConflictError when existing request fingerprint mismatches", async () => {
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT 1 FROM provisr_identity.memberships")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns")) {
          return {
            rows: [
              {
                id: "existing-turn",
                provisioning_run_id: "existing-run",
                request_fingerprint: "mismatched-fingerprint",
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn(),
    } as unknown as DbService;

    const events = {
      append: vi.fn(),
    } as unknown as ChatEventsService;

    const service = new ChatPersistenceService(db, events);
    await expect(service.submitPlanningTurn(baseParams)).rejects.toThrow(ConflictError);
  });

  it("handles concurrent unique constraint error and recovers stored turn", async () => {
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT 1 FROM provisr_identity.memberships")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT 1 FROM provisr_state.chat_sessions")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("INSERT INTO provisr_state.provisioning_runs")) {
          return { rows: [{ id: "run-1" }] };
        }
        if (sql.includes("INSERT INTO provisr_state.chat_turns")) {
          const error = new Error("duplicate key value violates unique constraint");
          throw error;
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT id, provisioning_run_id, request_fingerprint FROM provisr_state.chat_turns")) {
          return {
            rows: [
              {
                id: "concurrent-turn",
                provisioning_run_id: "concurrent-run",
                request_fingerprint: expectedFingerprint,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as DbService;

    const events = { append: vi.fn() } as unknown as ChatEventsService;
    const service = new ChatPersistenceService(db, events);

    const result = await service.submitPlanningTurn(baseParams);
    expect(result).toEqual({
      turnId: "concurrent-turn",
      runId: "concurrent-run",
      replayed: true,
    });
  });

  it("deletes session within transaction when no active runs exist", async () => {
    const executedQueries: string[] = [];
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("SELECT 1 FROM provisr_state.chat_sessions")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("SELECT state FROM provisr_state.provisioning_runs")) {
          return { rows: [] };
        }
        if (sql.includes("UPDATE provisr_state.chat_sessions")) {
          return { rowCount: 1, rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn(),
    } as unknown as DbService;

    const events = {} as ChatEventsService;
    const service = new ChatPersistenceService(db, events);

    await service.deleteSession("session-1", "workspace-1", "user-1");

    expect(executedQueries[0]).toBe("BEGIN");
    expect(executedQueries[1]).toContain("SELECT 1 FROM provisr_state.chat_sessions");
    expect(executedQueries[1]).toContain("FOR UPDATE");
    expect(executedQueries[2]).toContain("SELECT state FROM provisr_state.provisioning_runs");
    expect(executedQueries[3]).toContain("UPDATE provisr_state.chat_sessions");
    expect(executedQueries[4]).toBe("COMMIT");
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });

  it("rejects session deletion with ConflictError when active runs exist", async () => {
    const executedQueries: string[] = [];
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("SELECT 1 FROM provisr_state.chat_sessions")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("SELECT state FROM provisr_state.provisioning_runs")) {
          return { rows: [{ state: "running" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
      query: vi.fn(),
    } as unknown as DbService;

    const events = {} as ChatEventsService;
    const service = new ChatPersistenceService(db, events);

    await expect(service.deleteSession("session-1", "workspace-1", "user-1")).rejects.toThrow(
      ConflictError,
    );

    expect(executedQueries[0]).toBe("BEGIN");
    expect(executedQueries[1]).toContain("FOR UPDATE");
    expect(executedQueries[executedQueries.length - 1]).toBe("ROLLBACK");
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });
});
