import { describe, expect, it } from "vitest";
import {
  PostgresWorkflowTransitionStore,
  SqlClient,
  SqlPool,
  WorkflowTransactionWriters,
} from "../../src/state-machine/postgres-workflow-transition.store";

function fixture(rows: unknown[]): {
  client: SqlClient;
  pool: SqlPool;
  writers: WorkflowTransactionWriters;
  queries: string[];
  writes: string[];
} {
  const queries: string[] = [];
  const writes: string[] = [];
  const client: SqlClient = {
    async query(sql) {
      queries.push(sql);
      return { rows: queries.some((query) => query.includes("UPDATE provisr_state")) ? rows as never[] : [] };
    },
    release() {
      writes.push("release");
    },
  };
  return {
    client,
    pool: { async connect() { return client; } },
    writers: {
      async appendStateTransitionAudit() { writes.push("audit"); },
      async appendStateChangedOutboxEvent() { writes.push("outbox"); },
    },
    queries,
    writes,
  };
}

const input = {
  runId: "run-1",
  expectedState: "RECEIVED" as const,
  expectedStateVersion: 2,
  nextState: "CLOUD_CONTEXT_LOADED" as const,
  audit: {
    workspaceId: "workspace-1",
    runId: "run-1",
    actorId: "user-1",
    actorType: "user" as const,
    from: "RECEIVED" as const,
    to: "CLOUD_CONTEXT_LOADED" as const,
    stateVersion: 3,
  },
  event: {
    id: "event-1",
    type: "StateChangedEvent" as const,
    workspaceId: "workspace-1",
    runId: "run-1",
    correlationId: "correlation-1",
    from: "RECEIVED" as const,
    to: "CLOUD_CONTEXT_LOADED" as const,
    stateVersion: 3,
    occurredAt: "2026-08-13T09:00:00.000Z",
  },
};

describe("PostgresWorkflowTransitionStore", () => {
  it("uses one transaction for CAS state persistence, audit, and outbox writes", async () => {
    const db = fixture([{
      id: "run-1",
      workspace_id: "workspace-1",
      state: "CLOUD_CONTEXT_LOADED",
      state_version: 3,
      correlation_id: "correlation-1",
    }]);
    const store = new PostgresWorkflowTransitionStore(db.pool, db.writers);

    await expect(store.transitionAtomically(input)).resolves.toMatchObject({
      state: "CLOUD_CONTEXT_LOADED",
      stateVersion: 3,
    });
    expect(db.queries[0]).toBe("BEGIN");
    expect(db.queries[1]).toContain("state_version = state_version + 1");
    expect(db.queries[1]).toContain("AND state_version = $4");
    expect(db.queries).toContain("COMMIT");
    expect(db.writes).toEqual(["audit", "outbox", "release"]);
  });

  it("rolls back and writes no audit or outbox event when a concurrent update wins", async () => {
    const db = fixture([]);
    const store = new PostgresWorkflowTransitionStore(db.pool, db.writers);

    await expect(store.transitionAtomically(input)).resolves.toBeNull();
    expect(db.queries).toContain("ROLLBACK");
    expect(db.writes).toEqual(["release"]);
  });
});
