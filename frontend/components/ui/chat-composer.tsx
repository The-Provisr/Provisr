"use client";

import { useState } from "react";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  LinkIcon,
  MicIcon,
  SparklesIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

export function ChatComposer({ disabled = false, onSubmit }: { disabled?: boolean; onSubmit: (prompt: string) => Promise<boolean> }) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const message = prompt.trim();
    if (!message || disabled || submitting) return;
    setSubmitting(true);
    try {
      if (await onSubmit(message)) setPrompt("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <footer className="bg-white p-4 sm:p-6">
      <div className="mx-auto max-w-[850px]">
        <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 shadow-sm transition-all focus-within:ring-2 focus-within:ring-blue-100">
          <label className="mb-3 ml-2 flex items-center gap-2 text-gray-400">
            <SparklesIcon className="size-4" />
            <textarea
              aria-label="Message"
              className="min-h-6 flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
              disabled={disabled || submitting}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Describe infrastructure or upload an architecture diagram..."
              rows={1}
              value={prompt}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button className="bg-white px-3 py-1.5" variant="secondary">
              Cloud / Environment
              <ChevronDownIcon className="size-3.5" />
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              <Button className="px-3 py-1.5 text-gray-600" variant="ghost">
                <LinkIcon className="size-3.5" />
                Attach
              </Button>
              <Button className="px-3 py-1.5" variant="ghost">
                <MicIcon className="size-4 text-gray-500" />
                Voice
              </Button>
              <Button className="px-6 py-2.5" disabled={disabled || submitting || !prompt.trim()} onClick={() => void submit()} variant="primary">
                <ArrowUpIcon className="size-3.5" />
                {submitting ? "Sending" : "Send"}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-[10px] text-gray-400">
          Provisr drafts infrastructure plans for review. Execution requires
          policy checks, confirmation, and approval when required.
        </div>
      </div>
    </footer>
  );
}
