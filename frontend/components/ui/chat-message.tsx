import type { ComponentPayload } from "@provisr/shared-contracts";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type {
  ChatAttachment,
  ChatMessageItem,
  ChatMessageProps,
} from "@/lib/chat/chat-message-types";
import { formatBytes } from "@/lib/format";
import { formatRelativeTime } from "@/lib/time";
import { AssistantAvatar, UserAvatar } from "./chat-message-avatars";
import { ComponentCard } from "./chat-message-component-card";
import { StreamingCursor } from "./chat-message-cursor";
import { ToolSummary } from "./chat-message-tool-summary";

const markdownComponents = {
  p: ({ children }: ComponentProps<"p">) => (
    <p className="mb-2">{children}</p>
  ),
  code: ({ children }: ComponentProps<"code">) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-blue-500">
      {children}
    </code>
  ),
  a: ({ children, href }: ComponentProps<"a">) => (
    <a className="text-blue-500" href={href}>
      {children}
    </a>
  ),
};

function Attachments({ items }: { items: ChatAttachment[] }) {
  return (
    <ul className="mt-2 space-y-1 border-t border-blue-200 pt-2 text-xs text-gray-400">
      {items.map((attachment) => (
        <li className="truncate" key={attachment.name}>
          {attachment.name}
          {attachment.sizeBytes !== undefined
            ? ` · ${formatBytes(attachment.sizeBytes)}`
            : null}
        </li>
      ))}
    </ul>
  );
}

function MetaTime({ createdAt }: { createdAt: string }) {
  return <p className="mt-2 text-xs text-gray-400">{formatRelativeTime(createdAt)}</p>;
}

function RetryButton({
  message,
  onRetry,
}: {
  message: ChatMessageItem;
  onRetry?: (messageId: string) => void;
}) {
  if (message.status !== "error" || !onRetry) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label={`Retry message ${message.id}`}
      onClick={() => onRetry(message.id)}
      className="mt-2 text-xs font-semibold text-red-900"
    >
      Retry
    </button>
  );
}

function UserMessage({
  message,
  onRetry,
}: {
  message: ChatMessageItem;
  onRetry?: (messageId: string) => void;
}) {
  const sending = message.status === "sending";
  return (
    <div
      className={
        sending
          ? "flex items-start justify-end gap-3 opacity-70"
          : "flex items-start justify-end gap-3"
      }
    >
      <div className="flex max-w-[80%] flex-col items-end">
        <div className="rounded-3xl border border-blue-200 bg-blue-50 px-6 py-3 text-sm leading-relaxed text-white">
          {message.content}
          {message.attachments?.length ? (
            <Attachments items={message.attachments} />
          ) : null}
        </div>
        <MetaTime createdAt={message.createdAt} />
        <RetryButton message={message} onRetry={onRetry} />
      </div>
      <UserAvatar name={message.senderName} />
    </div>
  );
}

function AssistantMessage({
  message,
  renderComponent,
  onRetry,
}: {
  message: ChatMessageItem;
  renderComponent?: (payload: ComponentPayload) => ReactNode;
  onRetry?: (messageId: string) => void;
}) {
  const error = message.status === "error";
  return (
    <div className="flex items-start justify-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div
          className={
            error
              ? "rounded-3xl border border-l-2 border-red-200 bg-red-50 px-6 py-3 text-sm leading-relaxed text-white"
              : "rounded-3xl border border-gray-100 bg-white px-6 py-3 text-sm leading-relaxed text-white"
          }
        >
          <ReactMarkdown components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
          {message.status === "streaming" ? <StreamingCursor /> : null}
          {error && message.errorMessage ? (
            <p className="mt-2 text-xs font-medium text-red-900">
              {message.errorMessage}
            </p>
          ) : null}
        </div>
        {message.toolSummary ? (
          <ToolSummary summary={message.toolSummary} />
        ) : null}
        {message.components?.map((payload) => (
          <ComponentCard
            key={`${payload.type}-${payload.version}`}
            payload={payload}
            renderComponent={renderComponent}
          />
        ))}
        <MetaTime createdAt={message.createdAt} />
        <RetryButton message={message} onRetry={onRetry} />
      </div>
    </div>
  );
}

function SystemMessage({ message }: { message: ChatMessageItem }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[80%] rounded-full border border-gray-100 px-4 py-1.5 text-center text-xs text-gray-500">
        {message.content}
      </div>
    </div>
  );
}

export function ChatMessage({
  message,
  renderComponent,
  onRetry,
}: ChatMessageProps) {
  switch (message.role) {
    case "user":
      return <UserMessage message={message} onRetry={onRetry} />;
    case "system":
      return <SystemMessage message={message} />;
    case "assistant":
      return (
        <AssistantMessage
          message={message}
          renderComponent={renderComponent}
          onRetry={onRetry}
        />
      );
  }
}
