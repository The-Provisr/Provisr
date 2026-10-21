"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpIcon, SparklesIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

export function ChatComposer({
  disabled = false,
  loading = false,
  onSubmit,
}: {
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = value.trim();
    if (!prompt || disabled || loading) return;
    onSubmit(prompt);
    setValue("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <footer className="bg-white p-4 sm:p-6">
      <form className="mx-auto max-w-[850px]" onSubmit={submit}>
        <div className="rounded-3xl border border-gray-200 bg-gray-50 p-3 shadow-sm transition-all focus-within:ring-2 focus-within:ring-blue-100 sm:p-4">
          <label className="mb-2 flex items-center gap-2 px-2 text-gray-400">
            <SparklesIcon className="size-4 shrink-0" />
            <span className="sr-only">Provisioning request</span>
          </label>
          <textarea
            aria-label="Provisioning request"
            className="min-h-20 w-full resize-y bg-transparent px-2 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
            placeholder="Describe the infrastructure you need..."
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={20000}
            disabled={disabled}
          />
          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-[10px] text-gray-400">Shift + Enter for a new line</p>
            <Button className="px-5 py-2" variant="primary" type="submit" disabled={disabled || loading || !value.trim()}>
              {loading ? <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" /> : <ArrowUpIcon className="size-3.5" />}
              {loading ? "Starting..." : "Send"}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-center text-[10px] text-gray-400">Provisr drafts infrastructure plans for review. Execution requires policy checks, confirmation, and approval when required.</p>
      </form>
    </footer>
  );
}
