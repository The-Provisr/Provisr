import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus";
import type { SSEEvent } from "./types";

function makeEvent(type: SSEEvent["type"], id: string | null = null) {
  return { type, id, data: { n: 1 } } satisfies SSEEvent;
}

describe("EventBus", () => {
  it("delivers events only to subscribers of that type", () => {
    const bus = new EventBus();
    const onAssistant = vi.fn();
    const onError = vi.fn();
    bus.on("assistant_message", onAssistant);
    bus.on("error", onError);

    bus.emit(makeEvent("assistant_message"));

    expect(onAssistant).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers for the same type", () => {
    const bus = new EventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.on("run_completed", first);
    bus.on("run_completed", second);

    bus.emit(makeEvent("run_completed"));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on("tool_call_summary", handler);

    bus.emit(makeEvent("tool_call_summary"));
    unsubscribe();
    bus.emit(makeEvent("tool_call_summary"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores emits with no subscribers", () => {
    const bus = new EventBus();
    expect(() => bus.emit(makeEvent("clarification_question"))).not.toThrow();
  });
});
