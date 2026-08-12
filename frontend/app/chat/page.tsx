"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ui/chat-composer";
import { ChatSidebar } from "@/components/ui/chat-sidebar";
import {
  SettingsIcon,
  UploadIcon,
} from "@/components/ui/icons";
import { ChatMessage } from "@/components/ui/chat-message";
import { NavigationRail } from "@/components/ui/navigation-rail";
import type { ChatMessageItem } from "@/lib/chat/chat-message-types";

const drawerTabs = ["Manifest", "Policy", "Terraform Plan", "Approval"];

export default function ChatPage() {
  const { user } = useUser();
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(drawerTabs[0]);
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [error, setError] = useState<string>();
  const workspaceId = readWorkspaceId(user?.publicMetadata);

  async function submitPrompt(prompt: string) {
    if (!workspaceId) {
      setError("Your workspace is still being prepared. Refresh once setup completes.");
      return false;
    }

    setError(undefined);
    const clientMessageId = crypto.randomUUID();
    const pending: ChatMessageItem = {
      id: clientMessageId,
      runId: "pending",
      role: "user",
      content: prompt,
      status: "sending",
      createdAt: new Date().toISOString(),
      senderName: user?.fullName ?? undefined,
    };
    setMessages((current) => [...current, pending]);

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const session = await postJson<{ id?: string }>("/api/chat/sessions", {
          workspaceId,
          title: prompt.slice(0, 80),
        });
        if (!session.id) throw new Error("The chat session could not be created.");
        activeSessionId = session.id;
        setSessionId(activeSessionId);
      }

      const turn = await postJson<{ runId?: string }>("/api/chat/planning-turns", {
        sessionId: activeSessionId,
        workspaceId,
        prompt,
        clientMessageId,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!turn.runId) throw new Error("The planning request was not accepted.");
      setMessages((current) => current.map((message) => message.id === clientMessageId
        ? { ...message, runId: turn.runId!, status: "sent" }
        : message));
      return true;
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Unable to send the request.";
      setError(message);
      setMessages((current) => current.map((item) => item.id === clientMessageId
        ? { ...item, status: "error", errorMessage: message }
        : item));
      return false;
    }
  }

  return (
    <main className="flex h-screen overflow-hidden bg-gray-50 font-sans text-gray-800">
      <NavigationRail />
      <ChatSidebar />

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-50 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-gray-900">{sessionId ? "Infrastructure request" : "New infrastructure request"}</h3>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              className="hidden sm:inline-flex"
              disabled={!sessionId}
              onClick={() => setIsReviewOpen(true)}
              variant="secondary"
            >
              Preview &amp; Review
              <SettingsIcon className="size-3.5 text-gray-500" />
            </Button>
            <Button className="hidden sm:inline-flex" variant="secondary">
              Share Request
              <UploadIcon className="size-3.5 text-gray-500" />
            </Button>
         
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
          <div className="mx-auto max-w-[850px] space-y-6">
            {messages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">Describe the infrastructure you want to provision. Your request will be saved before planning starts.</p>
            ) : messages.map((message) => <ChatMessage key={message.id} message={message} />)}
            {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          </div>
        </div>

        <ChatComposer disabled={!workspaceId} onSubmit={submitPrompt} />

        {isReviewOpen ? (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[380px] flex-col border-l border-gray-100 bg-white shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-gray-100 px-5">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Preview &amp; Review
                </h2>
                <p className="mt-0.5 text-xs text-gray-400">Planning output</p>
              </div>
              <Button onClick={() => setIsReviewOpen(false)} variant="ghost">
                Close
              </Button>
            </div>

            <div className="border-b border-gray-100 px-3 py-2">
              <div className="grid grid-cols-2 gap-1">
                {drawerTabs.map((tab) => (
                  <button
                    className={
                      activeTab === tab
                        ? "rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                        : "rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                    }
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    type="button"
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <section className="rounded-lg border border-gray-100 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Awaiting planning output</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  The request is stored and queued. Manifest, policy, plan, and approval details will appear here once the planning workflow emits them.
                </p>
              </section>
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  );
}

async function postJson<T>(url: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.message === "string" ? payload.message : "Unable to complete the request.");
  }
  return payload as T;
}

function readWorkspaceId(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const workspaceId = (metadata as Record<string, unknown>).workspaceId;
  return typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : undefined;
}
