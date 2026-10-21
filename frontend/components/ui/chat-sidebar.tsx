"use client";

import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";

type ChatSessionSummary = {
  id: string;
  title: string;
  updatedAt?: string;
};

export function ChatSidebar({
  sessions,
  activeSessionId,
  loading = false,
  creating = false,
  onCreate,
  onSelect,
}: {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  loading?: boolean;
  creating?: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-gray-100 bg-white lg:flex">
      <div className="flex items-center justify-between p-4">
        <h2 className="font-semibold text-gray-900">Provisr</h2>
      </div>
      <div className="mb-4 px-4">
        <Button className="w-full py-2.5 text-sm" variant="primary" onClick={onCreate} disabled={creating}>
          <PlusIcon className="size-4" />
          {creating ? "Creating..." : "New Request"}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Recent sessions</div>
        {loading ? <div className="space-y-2 px-2 py-2" aria-label="Loading sessions" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="h-8 animate-pulse rounded-lg bg-gray-100" />)}</div> : null}
        {!loading && sessions.length === 0 ? <p className="px-2 py-3 text-xs leading-5 text-gray-400">Your requests will appear here.</p> : null}
        <nav className="space-y-1" aria-label="Chat sessions">
          {sessions.map((session) => (
            <button
              className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm ${activeSessionId === session.id ? "bg-blue-50 font-semibold text-blue-800" : "text-gray-600 hover:bg-gray-50"}`}
              key={session.id}
              onClick={() => onSelect(session.id)}
              type="button"
              aria-current={activeSessionId === session.id ? "page" : undefined}
            >
              {session.title || "New request"}
            </button>
          ))}
        </nav>
      </div>
      <div className="border-t border-gray-100 p-4">
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">Workspace chat</div>
      </div>
    </aside>
  );
}
