import type { ComponentPayload } from "@provisr/shared-contracts";
import type { ReactNode } from "react";

/**
 * FE-C02 chat message model.
 *
 * @migration When the FE-B05 SSE envelope lands, derive `ChatMessageItem` from
 * the shared `chat_message` contract (`ComponentType` in
 * packages/shared-contracts/src/index.ts:34) instead of keeping this local mirror.
 */

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessageStatus =
  | "sending"
  | "sent"
  | "streaming"
  | "complete"
  | "error";

export interface ChatToolSummary {
  toolName: string;
  durationMs: number;
  result: string;
}

export interface ChatAttachment {
  name: string;
  sizeBytes?: number;
}

export interface ChatMessageItem {
  /** Stable id (run-scoped). Key for in-place updates while streaming. */
  id: string;
  /** Run context: messages never mix across runs. */
  runId: string;
  role: ChatMessageRole;
  /** Markdown text (accumulated chunks for streaming messages). */
  content: string;
  status: ChatMessageStatus;
  createdAt: string;
  /** Used for the user avatar initials. */
  senderName?: string;
  attachments?: ChatAttachment[];
  toolSummary?: ChatToolSummary;
  /** FE-C01 component payloads; validated against the registry at render time. */
  components?: ComponentPayload[];
  /** Shown only in error state. */
  errorMessage?: string;
}

export interface ChatMessageProps {
  message: ChatMessageItem;
  /** FE-C01 registry renderer seam; falls back to a safe card when absent. */
  renderComponent?: (payload: ComponentPayload) => ReactNode;
  onRetry?: (messageId: string) => void;
}
