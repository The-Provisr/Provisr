import { orchestrationBaseUrl } from "@/lib/orchestration/base-url";
import { EventBus } from "./event-bus";
import type {
  SSEEvent,
  SSEEventPayloads,
  SSEEventType,
  SSESnapshot,
  SSEStatus,
} from "./types";
import { isSSEEventType } from "./types";

export const INITIAL_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;

export interface SSEClientOptions {
  workspaceId: string;
  getToken: () => Promise<string | null>;
  baseUrl?: string;
  bus?: EventBus;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  createEventSource?: (url: string) => EventSource;
}

function resolveEventType(
  evt: MessageEvent<string>,
  parsed: unknown,
): string | null {
  if (evt.type && evt.type !== "message") {
    return evt.type;
  }
  if (parsed && typeof parsed === "object" && "type" in parsed) {
    const type = (parsed as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return null;
}

function unwrapData(parsed: unknown): unknown {
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return (parsed as { data: unknown }).data;
  }
  return parsed;
}

function parseSequenceId(raw: string): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export class SSEClient {
  private readonly options: SSEClientOptions;
  private readonly bus: EventBus;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly createEventSource: (url: string) => EventSource;

  private es: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private currentStatus: SSEStatus = "disconnected";
  private currentLastEventId: string | null = null;
  private snapshotListeners = new Set<(snapshot: SSESnapshot) => void>();

  constructor(options: SSEClientOptions) {
    this.options = options;
    this.bus = options.bus ?? new EventBus();
    this.initialBackoffMs = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    this.createEventSource =
      options.createEventSource ?? ((url: string) => new EventSource(url));
  }

  get status(): SSEStatus {
    return this.currentStatus;
  }

  get lastEventId(): string | null {
    return this.currentLastEventId;
  }

  getSnapshot(): SSESnapshot {
    return {
      status: this.currentStatus,
      lastEventId: this.currentLastEventId,
    };
  }

  subscribe(listener: (snapshot: SSESnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  on<K extends SSEEventType>(
    type: K,
    handler: (event: SSEEvent<SSEEventPayloads[K]>) => void,
  ): () => void {
    return this.bus.on(type, handler);
  }

  async connect(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus("connecting");
    await this.openConnection();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.attempt = 0;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.setStatus("disconnected");
  }

  private async openConnection(): Promise<void> {
    if (this.stopped) return;

    const token = await this.options.getToken();
    if (this.stopped) return;
    if (!token) {
      this.setStatus("disconnected");
      return;
    }

    const es = this.createEventSource(this.buildUrl(token));
    this.es = es;

    es.onopen = () => {
      if (this.es !== es || this.stopped) return;
      this.attempt = 0;
      this.setStatus("connected");
    };

    es.onmessage = (evt) => {
      if (this.es !== es || this.stopped) return;
      this.handleMessage(evt);
    };

    es.onerror = () => {
      if (this.es !== es) return;
      this.handleError(es);
    };
  }

  private buildUrl(token: string): string {
    const base = this.options.baseUrl ?? orchestrationBaseUrl();
    const params = new URLSearchParams({ token });
    if (this.currentLastEventId) {
      params.set("lastEventId", this.currentLastEventId);
    }
    return `${base}/v1/workspaces/${encodeURIComponent(this.options.workspaceId)}/events?${params.toString()}`;
  }

  private handleMessage(evt: MessageEvent<string>): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(evt.data);
    } catch {
      return;
    }

    const type = resolveEventType(evt, parsed);
    if (!isSSEEventType(type)) {
      return;
    }

    const id =
      typeof evt.lastEventId === "string" && evt.lastEventId.length > 0
        ? evt.lastEventId
        : null;

    if (type !== "keepalive" && id) {
      if (this.isDuplicateOrOld(id)) return;
      this.setLastEventId(id);
    }

    this.bus.emit({ type, id, data: unwrapData(parsed) });
  }

  private isDuplicateOrOld(id: string): boolean {
    const last = this.currentLastEventId;
    if (!last) return false;
    if (last === id) return true;
    const incoming = parseSequenceId(id);
    const previous = parseSequenceId(last);
    if (incoming !== null && previous !== null) {
      return incoming <= previous;
    }
    return false;
  }

  private handleError(es: EventSource): void {
    es.close();
    if (this.es === es) {
      this.es = null;
    }
    if (this.stopped) return;

    this.setStatus("reconnecting");
    const exponent = Math.min(this.attempt, 30);
    const delay = Math.min(
      this.initialBackoffMs * 2 ** exponent,
      this.maxBackoffMs,
    );
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.openConnection();
    }, delay);
  }

  private setStatus(status: SSEStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.notify();
  }

  private setLastEventId(id: string): void {
    if (this.currentLastEventId === id) return;
    this.currentLastEventId = id;
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.snapshotListeners]) {
      listener(snapshot);
    }
  }
}
