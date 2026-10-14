import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSSE } from "./use-sse";

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    isLoaded: true,
    getToken: mockGetToken,
  }),
}));

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
}

function sessionJwt(workspaceId: string | null): string {
  const payload = workspaceId ? { metadata: { workspaceId } } : {};
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useSSE", () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubEnv("NEXT_PUBLIC_ORCHESTRATION_API_URL", "http://api.test");
    mockGetToken.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("connects using the workspace id decoded from the session token", async () => {
    mockGetToken.mockResolvedValue(sessionJwt("ws-9"));

    const { result } = renderHook(() => useSSE());

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.at(0).url).toContain(
      "/v1/workspaces/ws-9/events?token=",
    );

    act(() => MockEventSource.at(0).emitOpen());
    expect(result.current.status).toBe("connected");
  });

  it("uses an explicit workspace id when provided", async () => {
    mockGetToken.mockResolvedValue(sessionJwt("ws-ignored"));

    renderHook(() => useSSE("ws-explicit"));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.at(0).url).toContain(
      "/v1/workspaces/ws-explicit/events",
    );
  });

  it("stays disconnected when the session has no workspace claim", async () => {
    mockGetToken.mockResolvedValue(sessionJwt(null));

    const { result } = renderHook(() => useSSE());

    await flush();
    await flush();

    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.status).toBe("disconnected");
  });

  it("delivers events to subscribers and exposes lastEventId", async () => {
    mockGetToken.mockResolvedValue(sessionJwt("ws-9"));

    const { result } = renderHook(() => useSSE());
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    const handler = vi.fn();
    act(() => {
      result.current.subscribe("assistant_message", handler);
    });
    act(() => {
      MockEventSource.at(0).emitMessage(
        { type: "assistant_message", data: { message: "streamed reply" } },
        { id: "3" },
      );
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({
      type: "assistant_message",
      id: "3",
      data: { message: "streamed reply" },
    });
    expect(result.current.lastEventId).toBe("3");
  });

  it("closes the connection on unmount", async () => {
    mockGetToken.mockResolvedValue(sessionJwt("ws-9"));

    const { unmount } = renderHook(() => useSSE());
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    unmount();

    expect(MockEventSource.at(0).closed).toBe(true);
  });
});
