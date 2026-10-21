"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentPayload } from "@provisr/shared-contracts";
import { AppShell } from "@/components/ui/provisr-app";
import { ChatComposer } from "@/components/ui/chat-composer";
import { ChatMessage } from "@/components/ui/chat-message";
import { ChatSidebar } from "@/components/ui/chat-sidebar";
import { Button } from "@/components/ui/button";
import { RegistryProvider } from "@/components/registry/RegistryProvider";
import { RegistryRenderer } from "@/components/registry/RegistryRenderer";
import { SSEStatusBadge } from "@/components/ui/sse-status-badge";
import { orchestrationBaseUrl } from "@/lib/orchestration/base-url";
import type { ChatMessageItem } from "@/lib/chat/chat-message-types";
import { useSSE } from "@/lib/sse/use-sse";
import type { SSEEvent, SSEEventType } from "@/lib/sse/types";

type Session = {
  id: string;
  title: string;
  updatedAt: string;
  runIds: string[];
};

type Run = {
  id: string;
  sessionId: string;
  state: string;
  stateVersion?: number;
  prompt: string;
  manifestVersion?: number | null;
  policyDecision?: string | null;
  createdAt: string;
  provider?: string;
  region?: string;
  costEstimate?: unknown;
};

type PersistedMessage = {
  id: string;
  turnId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  componentPayloads?: unknown[];
  createdAt: string;
};

type PendingPrompt = {
  prompt: string;
  idempotencyKey: string;
  session?: Session;
};

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const RUN_STATES = new Set([
  "RECEIVED", "POLICY_LOADING", "CLOUD_CONTEXT_LOADING", "CLARIFYING",
  "MANIFEST_DRAFTING", "MANIFEST_VALIDATING", "MANIFEST_READY",
  "IAC_GENERATING", "PLANNING", "POLICY_CHECKING", "CONFIRMING",
  "APPROVING", "READY_TO_EXECUTE", "EXECUTING", "RECONCILING",
  "COMPLETED", "FAILED", "CANCELLED",
]);

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringAt(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key] as string;
  }
  return undefined;
}

function eventRunId(data: unknown): string | undefined {
  return stringAt(asRecord(data), "run_id", "runId", "request_id", "requestId");
}

function formatCost(value: unknown): string {
  const cost = asRecord(value);
  const amount = cost.monthlyTotalUsd ?? cost.monthly_total_usd ?? cost.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  return `${stringAt(cost, "currency") ?? "USD"} ${amount.toFixed(2)} / month`;
}

function toMessage(message: PersistedMessage, runs: Run[], senderName?: string): ChatMessageItem {
  const run = runs.find((candidate) => candidate.prompt === message.content);
  return {
    id: message.id,
    runId: run?.id ?? message.turnId ?? message.id,
    role: message.role,
    content: message.content,
    status: "complete",
    createdAt: message.createdAt,
    ...(message.role === "user" && senderName ? { senderName } : {}),
    ...(message.componentPayloads?.length ? { components: message.componentPayloads as ChatMessageItem["components"] } : {}),
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | { message?: string; error?: string } | null;
  if (!response.ok) {
    const record = asRecord(body);
    const details = record.message ?? record.error;
    throw new Error(typeof details === "string" ? details : `Request failed (${response.status})`);
  }
  return body as T;
}

function AuthenticatedChatPage() {
  const { getToken, userId } = useAuth();
  const { status, subscribe, workspaceId } = useSSE();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [runDetails, setRunDetails] = useState<Run | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRunDetails, setShowRunDetails] = useState(false);
  const pendingPrompts = useRef(new Map<string, PendingPrompt>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const tokenHeaders = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error("Your session has expired. Sign in again to continue.");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);

  const loadSessions = useCallback(async (selectFirst = true) => {
    if (!workspaceId) return;
    setLoadingSessions(true);
    setError(null);
    try {
      const headers = await tokenHeaders();
      const data = await readResponse<Session[]>(await fetch(
        `${orchestrationBaseUrl()}/v1/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=50&offset=0`,
        { headers, cache: "no-store" },
      ));
      setSessions(data);
      setActiveSessionId((current) => {
        if (current && data.some((item) => item.id === current)) return current;
        return selectFirst ? data[0]?.id ?? null : null;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load chat sessions.");
    } finally {
      setLoadingSessions(false);
    }
  }, [tokenHeaders, workspaceId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const createSession = useCallback(async (title?: string, resetUi = true) => {
    if (!workspaceId) throw new Error("Your workspace is still loading. Try again in a moment.");
    setCreatingSession(true);
    try {
      const headers = await tokenHeaders();
      const created = await readResponse<Session>(await fetch(`${orchestrationBaseUrl()}/v1/sessions`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ workspaceId, ...(title ? { title: title.slice(0, 200) } : {}) }),
      }));
      setSessions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      if (resetUi) {
        setActiveSessionId(created.id);
        setMessages([]);
        setRuns([]);
        setActiveRun(null);
        setRunDetails(null);
      }
      setError(null);
      return created;
    } finally {
      setCreatingSession(false);
    }
  }, [tokenHeaders, workspaceId]);

  useEffect(() => {
    if (!activeSessionId || !workspaceId) {
      setMessages([]);
      setRuns([]);
      setActiveRun(null);
      setRunDetails(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadingMessages(true);
      setError(null);
      try {
        const headers = await tokenHeaders();
        const base = orchestrationBaseUrl();
        const [messageResponse, runResponse] = await Promise.all([
          fetch(`${base}/v1/sessions/${activeSessionId}/messages?workspaceId=${encodeURIComponent(workspaceId)}`, { headers, cache: "no-store" }),
          fetch(`${base}/v1/runs?workspaceId=${encodeURIComponent(workspaceId)}&sessionId=${encodeURIComponent(activeSessionId)}`, { headers, cache: "no-store" }),
        ]);
        const [persisted, loadedRuns] = await Promise.all([
          readResponse<PersistedMessage[]>(messageResponse),
          readResponse<Run[]>(runResponse),
        ]);
        if (cancelled) return;
        setRuns(loadedRuns);
        const restored = persisted.map((item) => toMessage(item, loadedRuns, userId ?? undefined));
        for (const run of loadedRuns) {
          if (!restored.some((item) => item.role === "user" && item.content === run.prompt)) {
            restored.push({ id: `user:${run.id}`, runId: run.id, role: "user", content: run.prompt, status: "complete", createdAt: run.createdAt, senderName: userId ?? undefined });
          }
        }
        restored.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setMessages(restored);
        const latest = loadedRuns[0] ?? null;
        setActiveRun(latest);
        setRunDetails(latest);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load this session.");
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSessionId, tokenHeaders, userId, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const handlers: Array<[SSEEventType, (event: SSEEvent<unknown>) => void]> = [
      ["assistant_message", (event) => {
        const data = asRecord(event.data);
        const runId = eventRunId(event.data) ?? activeRun?.id;
        if (!runId || !stringAt(data, "session_id", "sessionId") && !runs.some((run) => run.id === runId) && activeSession?.runIds.includes(runId) !== true) return;
        const content = stringAt(data, "message", "content", "text");
        if (!content) return;
        setMessages((current) => {
          const id = `assistant:${runId}`;
          const existing = current.find((item) => item.id === id);
          if (existing) return current.map((item) => item.id === id ? { ...item, content: `${item.content}${content}`, status: "streaming" } : item);
          return [...current, { id, runId, role: "assistant", content, status: "streaming", createdAt: new Date().toISOString() }];
        });
      }],
      ["component_payload", (event) => {
        const data = asRecord(event.data);
        const runId = eventRunId(event.data) ?? activeRun?.id;
        if (!runId) return;
        const component = asRecord(data.component ?? data.payload);
        const payload = {
          type: component.type ?? data.component_id,
          version: component.version ?? data.component_version ?? "1.0.0",
          requestId: component.requestId ?? component.request_id ?? runId,
          data: component.data ?? data.payload,
        } as ComponentPayload;
        if (typeof payload.type !== "string" || !payload.data || typeof payload.data !== "object") return;
        setMessages((current) => {
          const id = `assistant:${runId}`;
          const existing = current.find((item) => item.id === id);
          if (existing) return current.map((item) => item.id === id ? { ...item, components: [...(item.components ?? []), payload] } : item);
          return [...current, { id, runId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString(), components: [payload] }];
        });
      }],
      ["tool_call_summary", (event) => {
        const data = asRecord(event.data);
        const runId = eventRunId(event.data) ?? activeRun?.id;
        if (!runId) return;
        const summary = stringAt(data, "summary", "result", "message");
        if (!summary) return;
        setMessages((current) => {
          const id = `assistant:${runId}`;
          const toolSummary = { toolName: stringAt(data, "tool_name", "toolName") ?? "Tool", durationMs: Number(data.duration_ms ?? data.durationMs ?? 0), result: summary };
          const existing = current.find((item) => item.id === id);
          if (existing) return current.map((item) => item.id === id ? { ...item, toolSummary } : item);
          return [...current, { id, runId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString(), toolSummary }];
        });
      }],
      ["clarification_question", (event) => {
        const data = asRecord(event.data);
        const runId = eventRunId(event.data) ?? activeRun?.id;
        if (!runId) return;
        const component = asRecord(data.component);
        const question = asRecord(data.question);
        const payload = component.type ? component : {
          type: "clarification_question", version: "1.0.0", requestId: runId,
          data: { id: runId, question: stringAt(question, "question", "text") ?? "Please provide more detail to continue.", inputType: "text" },
        };
        setMessages((current) => [...current, { id: `clarification:${event.id ?? idempotencyKey()}`, runId, role: "assistant", content: "I need a little more information before I can continue.", status: "complete", createdAt: new Date().toISOString(), components: [payload as ChatMessageItem["components"] extends Array<infer T> ? T : never] }]);
      }],
      ["run_state_changed", (event) => {
        const data = asRecord(event.data);
        const runId = eventRunId(event.data) ?? activeRun?.id;
        const state = stringAt(data, "to", "state", "status");
        if (!runId || !state) return;
        setRuns((current) => current.map((run) => run.id === runId ? { ...run, state } : run));
        setActiveRun((current) => current?.id === runId ? { ...current, state } : current);
        setRunDetails((current) => current?.id === runId ? { ...current, state } : current);
        setMessages((current) => current.map((message) => message.runId === runId && message.status === "streaming" && TERMINAL_STATES.has(state) ? { ...message, status: "complete" } : message));
        if (state === "FAILED") {
          const failure = stringAt(data, "error_message", "message");
          if (failure) {
            setMessages((current) => current.some((message) => message.id === `failure:${runId}`) ? current : [...current, { id: `failure:${runId}`, runId, role: "assistant", content: failure, status: "error", createdAt: new Date().toISOString() }]);
          }
        }
      }],
      ["error", (event) => {
        const data = asRecord(event.data);
        const runId = eventRunId(event.data) ?? activeRun?.id;
        if (!runId) return;
        const message = stringAt(data, "message", "error_message") ?? "The run encountered an error.";
        setMessages((current) => [...current, { id: `error:${event.id ?? idempotencyKey()}`, runId, role: "assistant", content: message, status: "error", createdAt: new Date().toISOString(), errorMessage: stringAt(data, "code", "error_code") }]);
        setError(message);
      }],
      ["run_completed", (event) => {
        const runId = eventRunId(event.data) ?? activeRun?.id;
        if (!runId) return;
        setMessages((current) => current.map((message) => message.runId === runId && message.status === "streaming" ? { ...message, status: "complete" } : message));
      }],
    ];
    const unsubscribers = handlers.map(([type, handler]) => subscribe(type, handler as never));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeRun?.id, activeSession?.runIds, runs, subscribe, workspaceId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!activeRun?.id || !workspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await tokenHeaders();
        const run = await readResponse<Run>(await fetch(
          `${orchestrationBaseUrl()}/v1/runs/${activeRun.id}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { headers, cache: "no-store" },
        ));
        if (!cancelled) setRunDetails(run);
      } catch {
        if (!cancelled) setRunDetails(activeRun);
      }
    })();
    return () => { cancelled = true; };
  }, [activeRun, tokenHeaders, workspaceId]);

  const submitPrompt = useCallback(async (rawPrompt: string, existingMessageId?: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || sending || !workspaceId) return;
    const messageId = existingMessageId ?? `user:${idempotencyKey()}`;
    const pending = pendingPrompts.current.get(messageId) ?? { prompt, idempotencyKey: idempotencyKey() };
    pendingPrompts.current.set(messageId, pending);
    const createdAt = new Date().toISOString();
    setError(null);
    setSending(true);
    setMessages((current) => {
      const exists = current.some((item) => item.id === messageId);
      const next = current.map((item) => item.id === messageId ? { ...item, status: "sending" as const, errorMessage: undefined } : item);
      return exists ? next : [...next, { id: messageId, runId: "pending", role: "user", content: prompt, status: "sending", createdAt, senderName: userId ?? undefined }];
    });
    try {
      const headers = await tokenHeaders();
      let session = activeSession ?? pending.session;
      if (!session) {
        session = await createSession(prompt, false);
        pending.session = session;
      }
      const run = await readResponse<Run>(await fetch(
        `${orchestrationBaseUrl()}/v1/runs?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": pending.idempotencyKey },
          body: JSON.stringify({ sessionId: session.id, prompt, idempotencyKey: pending.idempotencyKey }),
        },
      ));
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveSessionId(session.id);
      setActiveRun(run);
      setRunDetails(run);
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, runId: run.id, status: "sent" } : item));
      setSessions((current) => current.map((item) => item.id === session!.id ? { ...item, runIds: [...new Set([run.id, ...item.runIds])], title: item.title === "New request" ? prompt.slice(0, 48) : item.title, updatedAt: run.createdAt } : item));
      pendingPrompts.current.delete(messageId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not start this provisioning run.";
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, status: "error", errorMessage: message } : item));
      setError(message);
    } finally {
      setSending(false);
    }
  }, [activeSession, createSession, sending, tokenHeaders, userId, workspaceId]);

  const onRetry = useCallback((messageId: string) => {
    const pending = pendingPrompts.current.get(messageId);
    if (pending) void submitPrompt(pending.prompt, messageId);
  }, [submitPrompt]);

  const latestState = runDetails?.state ?? activeRun?.state ?? "Ready";
  const runTone = TERMINAL_STATES.has(latestState) ? (latestState === "COMPLETED" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700") : RUN_STATES.has(latestState) ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-600";
  const sessionLabel = useMemo(() => activeSession?.title || "New request", [activeSession]);
  const handleCreateSession = useCallback(() => {
    void createSession().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not create a session."));
  }, [createSession]);

  return (
    <RegistryProvider>
      <AppShell sidebar={<ChatSidebar sessions={sessions} activeSessionId={activeSessionId} loading={loadingSessions} creating={creatingSession} onCreate={handleCreateSession} onSelect={setActiveSessionId} />}>
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
          <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 sm:px-6">
            <div className="min-w-0">
              <h1 className="hidden truncate text-sm font-semibold text-gray-900 lg:block">{sessionLabel}</h1>
              <select className="max-w-[170px] truncate rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-800 lg:hidden" aria-label="Select chat session" value={activeSessionId ?? ""} onChange={(event) => setActiveSessionId(event.target.value || null)}>
                <option value="">New request</option>
                {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || "New request"}</option>)}
              </select>
              {activeRun ? <p className="mt-0.5 truncate text-[11px] text-gray-400">Run {activeRun.id}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SSEStatusBadge status={status} />
              <span className={`hidden rounded-full border px-2.5 py-1 text-[10px] font-semibold sm:inline-flex ${runTone}`}>{latestState.replaceAll("_", " ")}</span>
              <Button className="lg:hidden" variant="secondary" onClick={handleCreateSession} disabled={creatingSession}>New</Button>
              <Button className="hidden lg:inline-flex" variant="secondary" onClick={() => setShowRunDetails((value) => !value)}>{showRunDetails ? "Hide details" : "Run details"}</Button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-1 flex-col">
              {error ? <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">{error}<button className="ml-2 font-semibold underline" onClick={() => { setError(null); void loadSessions(false); }} type="button">Dismiss</button></div> : null}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8" aria-live="polite">
                <div className="mx-auto max-w-[850px] space-y-6">
                  {loadingMessages ? <div className="space-y-3" aria-label="Loading messages" aria-busy="true"><div className="h-16 animate-pulse rounded-2xl bg-gray-100" /><div className="ml-auto h-12 w-2/3 animate-pulse rounded-2xl bg-gray-100" /></div> : null}
                  {!loadingMessages && messages.length === 0 ? <div className="mx-auto mt-12 max-w-lg text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-xl text-blue-600">✦</div><h2 className="mt-4 text-lg font-semibold text-gray-900">What would you like to provision?</h2><p className="mt-2 text-sm leading-6 text-gray-500">Describe the infrastructure you need. Provisr will check workspace policy and prepare a plan for your review.</p></div> : null}
                  {messages.map((message) => (
                    <ChatMessage key={message.id} message={message} onRetry={onRetry} renderComponent={(payload) => <RegistryRenderer payload={payload} />} />
                  ))}
                  {activeRun ? <p className="text-center text-[11px] text-gray-400">Run state: {latestState.replaceAll("_", " ")}. Provisr will ask before any required confirmation or approval.</p> : null}
                </div>
              </div>
              <ChatComposer disabled={!workspaceId || sending || loadingSessions} loading={sending} onSubmit={(prompt) => { void submitPrompt(prompt); }} />
            </main>

            {showRunDetails ? <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-gray-100 bg-gray-50/60 p-4 lg:block" aria-label="Run details">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-900">Run Details</h2><button type="button" onClick={() => setShowRunDetails(false)} className="text-xs text-gray-500">Close</button></div>
              {runDetails ? <div className="mt-4 space-y-3">
                <dl className="space-y-3 rounded-xl border border-gray-100 bg-white p-4 text-xs">
                  {[["Run ID", runDetails.id], ["State", runDetails.state], ["Provider", runDetails.provider], ["Region", runDetails.region], ["Manifest version", runDetails.manifestVersion], ["Policy decision", runDetails.policyDecision]].map(([label, value]) => <div className="flex justify-between gap-3" key={label}><dt className="text-gray-400">{label}</dt><dd className="max-w-[170px] break-all text-right font-medium text-gray-800">{value == null || value === "" ? "—" : String(value)}</dd></div>)}
                </dl>
                <section className="rounded-xl border border-gray-100 bg-white p-4 text-xs"><span className="text-gray-400">Estimated cost</span><p className="mt-1 font-semibold text-gray-800">{formatCost(runDetails.costEstimate)}</p></section>
                <section className="rounded-xl border border-gray-100 bg-white p-4"><h3 className="text-xs font-semibold text-gray-700">Timeline</h3><p className="mt-1 text-xs text-gray-400">Detailed timeline is provided by FE-C20.</p></section>
                <section className="rounded-xl border border-gray-100 bg-white p-4"><h3 className="text-xs font-semibold text-gray-700">Artifacts</h3><p className="mt-1 text-xs text-gray-400">Artifact browsing is provided by FE-C23.</p></section>
              </div> : <p className="mt-4 rounded-xl border border-dashed border-gray-200 bg-white p-4 text-xs text-gray-500">Submit a request to see run details here.</p>}
            </aside> : null}
          </div>
        </section>
      </AppShell>
    </RegistryProvider>
  );
}

function ClerkSetupNotice() {
  return (
    <AppShell sidebar={<ChatSidebar sessions={[]} activeSessionId={null} onCreate={() => undefined} onSelect={() => undefined} />}>
      <section className="flex min-h-0 flex-1 items-center justify-center bg-white p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <h1 className="text-base font-semibold text-amber-950">Sign-in is not configured</h1>
          <p className="mt-2 text-sm leading-6 text-amber-900">Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> in the frontend environment and restart the app to connect chat sessions and provisioning runs.</p>
        </div>
      </section>
    </AppShell>
  );
}

export default function ChatPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return <ClerkSetupNotice />;
  return <AuthenticatedChatPage />;
}
