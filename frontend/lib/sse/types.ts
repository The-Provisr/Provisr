export type SSEEventType =
  | "assistant_message"
  | "component_payload"
  | "run_state_changed"
  | "tool_call_summary"
  | "clarification_question"
  | "error"
  | "run_completed"
  | "keepalive";

export const SSE_EVENT_TYPES: readonly SSEEventType[] = [
  "assistant_message",
  "component_payload",
  "run_state_changed",
  "tool_call_summary",
  "clarification_question",
  "error",
  "run_completed",
  "keepalive",
];

export function isSSEEventType(value: unknown): value is SSEEventType {
  return (
    typeof value === "string" &&
    (SSE_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * @migration Payload shapes below mirror the agent envelopes
 * (agent/app/outputs/models.py) where those exist. `run_state_changed` and
 * `run_completed` stay loose until OR-020 publishes the server contract.
 * Move this map to packages/shared-contracts once the BE event envelope lands.
 */
export interface SSEEventPayloads {
  assistant_message: { message: string };
  component_payload: { component_id?: string; payload: unknown };
  run_state_changed: { [key: string]: unknown };
  tool_call_summary: {
    tool_name?: string;
    summary?: string;
    [key: string]: unknown;
  };
  clarification_question: { question: unknown };
  error: { code?: string; message?: string; retryable?: boolean };
  run_completed: { [key: string]: unknown };
  keepalive: { workspaceId: string };
}

export interface SSEEvent<T = unknown> {
  type: SSEEventType;
  id: string | null;
  data: T;
}

export type SSEStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface SSESnapshot {
  status: SSEStatus;
  lastEventId: string | null;
}
