import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus";
import { SSEClient } from "./sse-client";
import type { SSEClientOptions } from "./sse-client";
import type { SSEEventType } from "./types";

class MockEventSource {
  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }
  static at(index: number): MockEventSource {
    const instance = MockEventSource.instances[index];
    if (!instance) {
      throw new Error(`No EventSource instance at index ${index}`);
    }
    return instance;
  }

  onopen: (() => void) | null = null;
  onmessage: ((evt: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: unknown, opts?: { id?: string; type?: string }) {
    this.onmessage?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
      lastEventId: opts?.id ?? "",
      type: opts?.type ?? "message",
    } as MessageEvent);
  }

  emitError() {
    this.onerror?.();
  }
}

function makeClient(overrides: Partial<SSEClientOptions> = {}) {
  return new SSEClient({
    workspaceId: "ws-1",
    getToken: vi.fn().mockResolvedValue("tok-1"),
    baseUrl: "http://api.test",
    createEventSource: (url) =>
      new MockEventSource(url) as unknown as EventSource,
    ...overrides,
  });
}

const DISPATCH_TYPES: SSEEventType[] = [
  "assistant_message",
  "component_payload",
  "run_state_changed",
  "tool_call_summary",
  "clarification_question",
  "error",
  "run_completed",
];

describe("SSEClient", () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("connects to the workspace events endpoint with the auth token", async () => {
    const client = makeClient();
    expect(client.status).toBe("disconnected");

    await client.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    const url = new URL(MockEventSource.at(0).url);
    expect(url.origin).toBe("http://api.test");
    expect(url.pathname).toBe("/v1/workspaces/ws-1/events");
    expect(url.searchParams.get("token")).toBe("tok-1");
    expect(url.searchParams.get("lastEventId")).toBeNull();
    expect(client.status).toBe("connecting");

    MockEventSource.at(0).emitOpen();
    expect(client.status).toBe("connected");
  });

  it("stays disconnected when no token is available", async () => {
    const client = makeClient({
      getToken: vi.fn().mockResolvedValue(null),
    });

    await client.connect();

    expect(MockEventSource.instances).toHaveLength(0);
    expect(client.status).toBe("disconnected");
  });

  it("dispatches every supported event type to its subscriber", async () => {
    const client = makeClient();
    await client.connect();
    const es = MockEventSource.at(0);

    const received: string[] = [];
    for (const type of DISPATCH_TYPES) {
      client.on(type, (event) => received.push(event.type));
    }

    for (const type of DISPATCH_TYPES) {
      es.emitMessage({ type, data: { anything: true } });
    }

    expect(received).toEqual(DISPATCH_TYPES);
  });

  it("unwraps envelope data and tracks lastEventId from the frame", async () => {
    const client = makeClient();
    await client.connect();
    const handler = vi.fn();
    client.on("assistant_message", handler);

    MockEventSource.at(0).emitMessage(
      { message: "hello world" },
      { type: "assistant_message", id: "7" },
    );

    expect(handler).toHaveBeenCalledWith({
      type: "assistant_message",
      id: "7",
      data: { message: "hello world" },
    });
    expect(client.lastEventId).toBe("7");
  });

  it("dispatches keepalive frames without touching lastEventId", async () => {
    const client = makeClient();
    await client.connect();
    const handler = vi.fn();
    client.on("keepalive", handler);

    MockEventSource.at(0).emitMessage(
      { type: "keepalive", workspaceId: "ws-1" },
      { id: "5" },
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.lastEventId).toBeNull();
  });

  it("ignores unknown event types and malformed frames", async () => {
    const client = makeClient();
    await client.connect();
    const es = MockEventSource.at(0);
    es.emitOpen();
    const handler = vi.fn();
    client.on("assistant_message", handler);

    es.emitMessage({ type: "mystery_event" }, { id: "9" });
    es.emitMessage("not json at all");

    expect(handler).not.toHaveBeenCalled();
    expect(client.lastEventId).toBeNull();
    expect(client.status).toBe("connected");
  });

  it("drops duplicate and older replayed events", async () => {
    const client = makeClient();
    await client.connect();
    const es = MockEventSource.at(0);
    const handler = vi.fn();
    client.on("assistant_message", handler);

    es.emitMessage({ type: "assistant_message", data: { message: "a" } }, { id: "41" });
    es.emitMessage({ type: "assistant_message", data: { message: "a" } }, { id: "41" });
    es.emitMessage({ type: "assistant_message", data: { message: "old" } }, { id: "40" });
    es.emitMessage({ type: "assistant_message", data: { message: "b" } }, { id: "43" });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(client.lastEventId).toBe("43");
  });

  it("reconnects with backoff, a fresh token and the tracked lastEventId", async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce("tok-1")
      .mockResolvedValue("tok-2");
    const client = makeClient({ getToken });
    await client.connect();

    MockEventSource.at(0).emitMessage(
      { type: "assistant_message", data: { message: "missed while offline" } },
      { id: "42" },
    );
    MockEventSource.at(0).emitError();

    expect(client.status).toBe("reconnecting");
    expect(MockEventSource.at(0).closed).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(MockEventSource.instances).toHaveLength(2);
    const url = new URL(MockEventSource.at(1).url);
    expect(url.searchParams.get("token")).toBe("tok-2");
    expect(url.searchParams.get("lastEventId")).toBe("42");
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("backs off 1s, 2s, 4s, 8s, 16s then caps at 30s", async () => {
    const client = makeClient();
    await client.connect();
    expect(MockEventSource.instances).toHaveLength(1);

    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const delay of expectedDelays) {
      const before = MockEventSource.instances.length;
      MockEventSource.at(before - 1).emitError();

      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(MockEventSource.instances).toHaveLength(before);

      await vi.advanceTimersByTimeAsync(1);
      expect(MockEventSource.instances).toHaveLength(before + 1);
    }
  });

  it("resets the backoff counter after a successful open", async () => {
    const client = makeClient();
    await client.connect();

    MockEventSource.at(0).emitError();
    await vi.advanceTimersByTimeAsync(1_000);
    MockEventSource.at(1).emitOpen();

    MockEventSource.at(1).emitError();
    await vi.advanceTimersByTimeAsync(999);
    expect(MockEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("stops handling frames after disconnect", async () => {
    const client = makeClient();
    await client.connect();
    const es = MockEventSource.at(0);
    const handler = vi.fn();
    client.on("assistant_message", handler);

    client.disconnect();

    expect(client.status).toBe("disconnected");
    expect(es.closed).toBe(true);

    es.emitMessage({ type: "assistant_message", data: { message: "late" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears a pending reconnect timer on disconnect", async () => {
    const client = makeClient();
    await client.connect();

    MockEventSource.at(0).emitError();
    client.disconnect();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("reports status transitions to snapshot subscribers", async () => {
    const client = makeClient();
    const snapshots: string[] = [];
    const unsubscribe = client.subscribe((snapshot) => {
      snapshots.push(snapshot.status);
    });

    await client.connect();
    MockEventSource.at(0).emitOpen();
    MockEventSource.at(0).emitError();
    client.disconnect();
    unsubscribe();

    expect(snapshots).toEqual([
      "disconnected",
      "connecting",
      "connected",
      "reconnecting",
      "disconnected",
    ]);
  });

  it("emits events through a shared bus when one is provided", async () => {
    const bus = new EventBus();
    const client = makeClient({ bus });
    const handler = vi.fn();
    bus.on("run_state_changed", handler);

    await client.connect();
    MockEventSource.at(0).emitMessage({
      type: "run_state_changed",
      data: { state: "planning" },
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
