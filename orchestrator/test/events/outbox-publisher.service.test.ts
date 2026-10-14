import { describe, expect, it } from "vitest";
import { OutboxEvent, OutboxPublisherService, OutboxStore } from "../../src/events/outbox-publisher.service";

const event: OutboxEvent = {
  id: "row-1", eventId: "event-1", workspaceId: "workspace-1", eventType: "StateChangedEvent",
  correlationId: "correlation-1", payload: { to: "POLICY_LOADED" }, createdAt: "2026-08-13T10:00:00Z", deliveryAttempts: 1,
};

function storeWith(next: OutboxEvent | null): { store: OutboxStore; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    store: {
      async claimOldestPending() { calls.push("claim"); return next; },
      async markPublished() { calls.push("published"); },
      async reschedule() { calls.push("retry"); },
      async markFailed() { calls.push("failed"); },
    },
  };
}

describe("OR-019 outbox publisher", () => {
  it("publishes the oldest claimed event then marks it sent", async () => {
    const fixture = storeWith(event);
    const service = new OutboxPublisherService(fixture.store, { async publish() { fixture.calls.push("sse"); } });
    await expect(service.publishNext()).resolves.toBe("published");
    expect(fixture.calls).toEqual(["claim", "sse", "published"]);
  });

  it("retries a failed delivery with exponential backoff before the third attempt", async () => {
    const fixture = storeWith(event);
    const service = new OutboxPublisherService(fixture.store, { async publish() { throw new Error("offline"); } }, () => new Date(0));
    await expect(service.publishNext()).resolves.toBe("retried");
    expect(fixture.calls).toEqual(["claim", "retry"]);
  });

  it("stops retrying after the third failed attempt", async () => {
    const fixture = storeWith({ ...event, deliveryAttempts: 3 });
    const service = new OutboxPublisherService(fixture.store, { async publish() { throw new Error("offline"); } });
    await expect(service.publishNext()).resolves.toBe("failed");
    expect(fixture.calls).toEqual(["claim", "failed"]);
  });

  it("does nothing when no unpublished event is available", async () => {
    const fixture = storeWith(null);
    const service = new OutboxPublisherService(fixture.store, { async publish() { throw new Error("must not publish"); } });
    await expect(service.publishNext()).resolves.toBe("empty");
  });
});
