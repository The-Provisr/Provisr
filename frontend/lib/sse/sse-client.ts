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

const SERVER_EVENT_NAMES = [
  "RunCreatedEvent", "StateChangedEvent", "AgentSessionLinkedEvent",
  "ApprovalDecisionEvent", "AssistantMessageEvent", "ClarificationAnsweredEvent",
  "ClarificationQuestionEvent", "ComponentPayloadEvent", "ComponentPayloadRejectedEvent",
  "ManifestConfirmedEvent", "ManifestReadyEvent", "ManifestRevisionRequestedEvent",
  "ManifestValidationFailedEvent", "PolicyRequirementsLoadedEvent", "CloudContextLoadedEvent",
  "RunFailedEvent", "RunCompletedEvent", "RunCancelledEvent", "ToolCallSummaryEvent",
  "ToolSummaryEvent",
] as const;

function normalizedEvents(rawType: string | null, value: unknown): Array<{ type: SSEEventType; data: unknown }> {
  if (!rawType) return [];
  const data = unwrapData(value);
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const aliases: Record<string, SSEEventType> = {
    assistant_message: "assistant_message", AssistantMessageEvent: "assistant_message",
    component_payload: "component_payload", ComponentPayloadEvent: "component_payload",
    run_state_changed: "run_state_changed", StateChangedEvent: "run_state_changed",
    tool_call_summary: "tool_call_summary", ToolCallSummaryEvent: "tool_call_summary", ToolSummaryEvent: "tool_call_summary",
    clarification_question: "clarification_question", ClarificationQuestionEvent: "clarification_question",
    error: "error", ErrorEvent: "error", RunFailedEvent: "error", ComponentPayloadRejectedEvent: "error",
    run_completed: "run_completed", RunCompletedEvent: "run_completed", RunCancelledEvent: "run_completed",
    keepalive: "keepalive",
  };
  if (rawType === "ManifestReadyEvent") {
    const events: Array<{ type: SSEEventType; data: unknown }> = [];
    if (typeof record.message === "string" && record.message) {
      events.push({ type: "assistant_message", data: { ...record, message: record.message } });
    }
    if (Array.isArray(record.components)) {
      for (const component of record.components) events.push({ type: "component_payload", data: { ...record, component } });
    }
    events.push({ type: "run_state_changed", data: record });
    return events;
  }
  const known = aliases[rawType];
  if (known) return [{ type: known, data }];
  // The orchestrator emits named state events for workflow steps. Preserve
  // their payloads as state updates so the UI can show progress without
  // needing a frontend alias for every backend transition name.
  if (rawType.endsWith("Event")) return [{ type: "run_state_changed", data }];
  return [];
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
  private readonly seenEventIds = new Set<string>();
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

    let es: EventSource;
    try {
      const token = await this.options.getToken();
      if (this.stopped) return;
      if (!token) {
        // No credentials: go offline and stay stopped so a later connect()
        // (e.g. once the user signs in) can retry instead of no-op'ing.
        this.stopped = true;
        this.attempt = 0;
        this.setStatus("disconnected");
        return;
      }
      es = this.createEventSource(this.buildUrl(token));
    } catch {
      // Token fetch or EventSource construction failed: treat it like a
      // transport error so we back off and retry instead of leaving the
      // client stuck on "connecting".
      if (!this.stopped) this.scheduleReconnect();
      return;
    }
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

    if (typeof es.addEventListener === "function") {
      for (const eventName of SERVER_EVENT_NAMES) {
        es.addEventListener(eventName, (event) => {
          if (this.es !== es || this.stopped) return;
          this.handleMessage(event as MessageEvent<string>);
        });
      }
    }

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

    const id =
      typeof evt.lastEventId === "string" && evt.lastEventId.length > 0
        ? evt.lastEventId
        : null;

    if (type !== "keepalive" && id) {
      if (this.isDuplicateOrOld(id)) return;
      this.seenEventIds.add(id);
      if (this.seenEventIds.size > 2_000) {
        const oldest = this.seenEventIds.values().next().value;
        if (oldest) this.seenEventIds.delete(oldest);
      }
      this.setLastEventId(id);
    }

    for (const normalized of normalizedEvents(type, parsed)) {
      if (!isSSEEventType(normalized.type)) continue;
      this.bus.emit({ type: normalized.type, id, data: normalized.data });
    }
  }

  private isDuplicateOrOld(id: string): boolean {
    const last = this.currentLastEventId;
    if (this.seenEventIds.has(id)) return true;
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

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
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
