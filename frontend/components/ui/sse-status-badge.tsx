import type { SSEStatus } from "@/lib/sse/types";

const STATUS_PRESENTATION: Record<
  SSEStatus,
  { label: string; container: string; dot: string; text: string }
> = {
  connected: {
    label: "Live",
    container: "border-green-200 bg-green-50",
    dot: "bg-green-500",
    text: "text-green-700",
  },
  connecting: {
    label: "Connecting",
    container: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
    text: "text-amber-900",
  },
  reconnecting: {
    label: "Reconnecting",
    container: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
    text: "text-amber-900",
  },
  disconnected: {
    label: "Offline",
    container: "border-red-200 bg-red-50",
    dot: "bg-red-500",
    text: "text-red-900",
  },
};

export function SSEStatusBadge({ status }: { status: SSEStatus }) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${presentation.container} ${presentation.text}`}
      role="status"
    >
      <span className={`size-2.5 rounded-full ${presentation.dot}`} />
      {presentation.label}
    </span>
  );
}
