import type {
  SSEEvent,
  SSEEventPayloads,
  SSEEventType,
} from "./types";

export type SSEEventHandler<T = unknown> = (event: SSEEvent<T>) => void;

type StoredHandler = (event: SSEEvent<unknown>) => void;

export class EventBus {
  private listeners = new Map<SSEEventType, Set<StoredHandler>>();

  on<K extends SSEEventType>(
    type: K,
    handler: SSEEventHandler<SSEEventPayloads[K]>,
  ): () => void {
    const stored = handler as unknown as StoredHandler;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set<StoredHandler>();
      this.listeners.set(type, set);
    }
    set.add(stored);
    return () => {
      set?.delete(stored);
    };
  }

  emit(event: SSEEvent<unknown>): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const handler of [...set]) {
      handler(event);
    }
  }
}
