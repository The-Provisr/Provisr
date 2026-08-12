import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

export type ChatSessionItem = {
  id: string;
  title: string;
  updatedAt: string;
};

export function ChatSidebar({
  activeSessionId,
  onNewRequest,
  onSelectSession,
  sessions,
}: {
  activeSessionId?: string;
  onNewRequest: () => void;
  onSelectSession: (sessionId: string) => void;
  sessions: ChatSessionItem[];
}) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-gray-100 bg-white lg:flex">
      <div className="flex items-center justify-between p-4">
        <h2 className="font-semibold text-gray-900">Provisr</h2>
        <IconButton className="size-8" label="Search requests">
          <SearchIcon className="size-4" />
        </IconButton>
      </div>

      <div className="mb-6 px-4">
        <Button className="w-full py-2.5 text-sm" onClick={onNewRequest} variant="primary">
          <PlusIcon className="size-4" />
          New Request
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <section>
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-400">Recent requests</div>
          <div className="space-y-1">
            {sessions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-gray-400">No saved requests yet.</p>
            ) : sessions.map((session) => (
              <button
                className={cn(
                  "w-full rounded-lg p-2 text-left text-sm hover:bg-gray-50",
                  session.id === activeSessionId ? "bg-gray-100 text-gray-900" : "text-gray-600",
                )}
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                type="button"
              >
                <span className="block truncate font-medium">{session.title}</span>
                <span className="mt-1 block text-xs text-gray-400">{formatSessionTime(session.updatedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="border-t border-gray-100 p-4">
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
          <div className="text-sm font-semibold text-gray-900">Workspace</div>
          <div className="mt-0.5 text-xs text-gray-500">Your active workspace</div>
        </div>
      </div>
    </aside>
  );
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
