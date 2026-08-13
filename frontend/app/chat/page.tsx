"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ui/chat-composer";
import { ChatSidebar, type ChatSessionItem } from "@/components/ui/chat-sidebar";
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
  const [activeTab, setActiveTab] = useState<string>(drawerTabs[0]!);
  const [sessionId, setSessionId] = useState<string>();
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [error, setError] = useState<string>();
  const [planningOutput, setPlanningOutput] = useState<PlanningOutput>();
  const lastEventId = useRef(0);
  const workspaceId = readWorkspaceId(user?.publicMetadata);

  useEffect(() => {
    if (!workspaceId) {
      setSessions([]);
      return;
    }
    void loadSessions(workspaceId).then(setSessions).catch(() => setError("Unable to load saved requests."));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const stream = new EventSource(`/api/chat/events?workspaceId=${encodeURIComponent(workspaceId)}&after=${lastEventId.current}`);
    const refreshActiveSession = () => {
      if (!sessionId) return;
      void getJson<StoredMessage[]>(`/api/chat/sessions/${sessionId}/messages?workspaceId=${encodeURIComponent(workspaceId)}`)
        .then((stored) => setMessages(stored.map(toChatMessage)))
        .catch(() => setError("Planning completed, but the updated chat could not be loaded."));
    };
    stream.addEventListener("planning.started", (event) => {
      lastEventId.current = Number(event.lastEventId) || lastEventId.current;
    });
    stream.addEventListener("planning.completed", (event) => {
      lastEventId.current = Number(event.lastEventId) || lastEventId.current;
      const payload = parsePlanningEvent(event.data);
      if (sessionId && payload.sessionId !== sessionId) return;
      setPlanningOutput(payload);
      refreshActiveSession();
    });
    stream.addEventListener("planning.failed", (event) => {
      lastEventId.current = Number(event.lastEventId) || lastEventId.current;
      setError("Planning could not be completed. You can retry the request.");
    });
    return () => stream.close();
  }, [sessionId, workspaceId]);

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
        setSessions((current) => [{ id: session.id!, title: prompt.slice(0, 80), updatedAt: new Date().toISOString() }, ...current]);
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
      const stored = await getJson<StoredMessage[]>(`/api/chat/sessions/${activeSessionId}/messages?workspaceId=${encodeURIComponent(workspaceId)}`);
      setMessages(stored.map(toChatMessage));
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

  async function selectSession(nextSessionId: string) {
    if (!workspaceId || nextSessionId === sessionId) return;
    setError(undefined);
    try {
      const stored = await getJson<StoredMessage[]>(`/api/chat/sessions/${nextSessionId}/messages?workspaceId=${encodeURIComponent(workspaceId)}`);
      setSessionId(nextSessionId);
      setMessages(stored.map(toChatMessage));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the selected request.");
    }
  }

  function startNewRequest() {
    setSessionId(undefined);
    setMessages([]);
    setError(undefined);
    setPlanningOutput(undefined);
  }

  return (
    <main className="flex h-screen overflow-hidden bg-gray-50 font-sans text-gray-800">
      <NavigationRail />
      <ChatSidebar activeSessionId={sessionId} onNewRequest={startNewRequest} onSelectSession={(id) => void selectSession(id)} sessions={sessions} />

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-50 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-gray-900">{sessions.find((session) => session.id === sessionId)?.title ?? "New infrastructure request"}</h3>
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
              <PlanningPreview activeTab={activeTab} output={planningOutput} />
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  );
}

type PlanningOutput = {
  runId?: string;
  sessionId?: string;
  manifest?: unknown;
  policyAndCloudEvidence?: Array<{ tool?: string; summary?: string | null }>;
  planStatus?: string;
};

function parsePlanningEvent(data: string): PlanningOutput {
  try {
    const value = JSON.parse(data) as PlanningOutput;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function PlanningPreview({ activeTab, output }: { activeTab: string; output?: PlanningOutput }) {
  if (!output) {
    return <section className="rounded-lg border border-gray-100 p-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Awaiting planning output</h3><p className="mt-2 text-sm leading-relaxed text-gray-700">The request is stored and queued. Live policy, cloud context, and manifest output will appear here.</p></section>;
  }
  if (activeTab === "Policy") {
    return <section className="rounded-lg border border-gray-100 p-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Policy and cloud evidence</h3><ul className="mt-3 space-y-2 text-sm text-gray-700">{(output.policyAndCloudEvidence ?? []).map((item, index) => <li key={`${item.tool}-${index}`}><span className="font-medium">{item.tool ?? "evidence"}</span>{item.summary ? ` — ${item.summary}` : ""}</li>)}</ul></section>;
  }
  if (activeTab === "Manifest") {
    return <section className="rounded-lg border border-gray-100 p-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Generated manifest</h3><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700">{output.manifest ? JSON.stringify(output.manifest, null, 2) : "The agent did not return a manifest draft."}</pre></section>;
  }
  if (activeTab === "Terraform Plan") {
    return <section className="rounded-lg border border-gray-100 p-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Terraform plan</h3><p className="mt-2 text-sm text-gray-700">{output.planStatus === "not_generated" ? "A Terraform plan has not been generated in this planning stage." : "No plan output is available."}</p></section>;
  }
  return <section className="rounded-lg border border-gray-100 p-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Approval</h3><p className="mt-2 text-sm text-gray-700">Approval is evaluated after a plan is generated.</p></section>;
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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.message === "string" ? payload.message : "Unable to load saved requests.");
  }
  return payload as T;
}

async function loadSessions(workspaceId: string): Promise<ChatSessionItem[]> {
  return getJson<ChatSessionItem[]>(`/api/chat/sessions?workspaceId=${encodeURIComponent(workspaceId)}`);
}

type StoredMessage = {
  id: string;
  turnId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

function toChatMessage(message: StoredMessage): ChatMessageItem {
  return {
    id: message.id,
    runId: message.turnId,
    role: message.role,
    content: message.content,
    status: "complete",
    createdAt: message.createdAt,
  };
}

function readWorkspaceId(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const workspaceId = (metadata as Record<string, unknown>).workspaceId;
  return typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : undefined;
}
