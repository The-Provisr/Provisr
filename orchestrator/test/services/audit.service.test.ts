import { describe, expect, it, vi } from "vitest";
import { AuditService, createAuditService } from "../../src/services/audit.service";
import type { DbService } from "../../src/db/db.service";

describe("AuditService", () => {
  const baseParams = {
    workspaceId: "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a",
    eventType: "prompt_received" as const,
    actorId: "user-1",
    actorType: "user" as const,
    resourceType: "chat_session",
    resourceId: "session-1",
    payload: { prompt: "provision an ecs cluster" },
    correlationId: "c1c2c3c4-2c4a-4d6e-8f0a-1b2c3d4e5f6a",
  };

  it("creates service instance via factory", () => {
    const db = {} as DbService;
    const service = createAuditService(db);
    expect(service).toBeInstanceOf(AuditService);
  });

  it("manages transaction lifecycle when no client is provided", async () => {
    const queries: string[] = [];
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT hash FROM")) {
          return { rows: [{ hash: "prev-hash-123" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
    } as unknown as DbService;

    const service = new AuditService(db);
    await service.append(baseParams);

    expect(db.connect).toHaveBeenCalledTimes(1);
    expect(queries[0]).toBe("BEGIN");
    expect(queries[1]).toContain("pg_advisory_xact_lock");
    expect(queries[2]).toContain("SELECT hash FROM provisr_audit.audit_events");
    expect(queries[3]).toContain("INSERT INTO provisr_audit.audit_events");
    expect(queries[4]).toBe("COMMIT");
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases client when unmanaged transaction fails", async () => {
    const queries: string[] = [];
    const poolClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("INSERT INTO")) {
          throw new Error("DB write failure");
        }
        if (sql.includes("SELECT hash FROM")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const db = {
      connect: vi.fn().mockResolvedValue(poolClient),
    } as unknown as DbService;

    const service = new AuditService(db);
    await expect(service.append(baseParams)).rejects.toThrow("DB write failure");

    expect(queries[0]).toBe("BEGIN");
    expect(queries[queries.length - 1]).toBe("ROLLBACK");
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });

  it("uses provided client without managing transaction", async () => {
    const queries: string[] = [];
    const callerClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT hash FROM")) {
          return { rows: [{ hash: "hash-abc" }] };
        }
        return { rows: [] };
      }),
    };

    const db = {
      connect: vi.fn(),
    } as unknown as DbService;

    const service = new AuditService(db);
    await service.append(baseParams, callerClient);

    expect(db.connect).not.toHaveBeenCalled();
    expect(queries).not.toContain("BEGIN");
    expect(queries).not.toContain("COMMIT");
    expect(queries[0]).toContain("pg_advisory_xact_lock");
    expect(queries[1]).toContain("SELECT hash FROM provisr_audit.audit_events");
    expect(queries[2]).toContain("INSERT INTO provisr_audit.audit_events");
  });
});
