export interface OutboxEvent {
  id: string;
  eventId: string;
  workspaceId: string;
  eventType: string;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  deliveryAttempts: number;
}

/** The durable store returns events in created_at order and claims them first. */
export interface OutboxStore {
  claimOldestPending(): Promise<OutboxEvent | null>;
  markPublished(eventId: string): Promise<void>;
  reschedule(eventId: string, attempt: number, nextAttemptAt: Date, error: string): Promise<void>;
  markFailed(eventId: string, attempt: number, error: string): Promise<void>;
}

/** Implemented by the live SSE hub; delivery is acknowledged only after this resolves. */
export interface SseEventPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export class OutboxPublisherService {
  static readonly MAX_DELIVERY_ATTEMPTS = 3;

  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: SseEventPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Processes at most one event so a single worker preserves creation order. */
  async publishNext(): Promise<"published" | "retried" | "failed" | "empty"> {
    const event = await this.store.claimOldestPending();
    if (!event) return "empty";
    try {
      await this.publisher.publish(event);
      await this.store.markPublished(event.eventId);
      return "published";
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown SSE publish error";
      if (event.deliveryAttempts >= OutboxPublisherService.MAX_DELIVERY_ATTEMPTS) {
        await this.store.markFailed(event.eventId, event.deliveryAttempts, message);
        return "failed";
      }
      // 1s, then 2s: bounded exponential backoff before the final attempt.
      const delayMs = 1_000 * 2 ** Math.max(0, event.deliveryAttempts - 1);
      await this.store.reschedule(event.eventId, event.deliveryAttempts, new Date(this.now().getTime() + delayMs), message);
      return "retried";
    }
  }
}
