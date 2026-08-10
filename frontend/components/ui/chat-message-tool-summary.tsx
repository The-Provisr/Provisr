"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { formatDurationMs } from "@/lib/format";
import type { ChatToolSummary } from "@/lib/chat/chat-message-types";

export function ToolSummary({ summary }: { summary: ChatToolSummary }) {
  const [open, setOpen] = useState(false);
  const label = `${summary.toolName} · ${formatDurationMs(summary.durationMs)}`;

  return (
    <div className="mt-2 max-w-[480px] rounded-lg border border-gray-100 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-gray-400"
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className={open ? "size-3 rotate-180" : "size-3"} />
      </button>
      {open ? (
        <p className="border-t border-gray-100 px-3 pb-2 pt-2 text-xs leading-relaxed text-gray-500">
          {summary.result}
        </p>
      ) : null}
    </div>
  );
}
