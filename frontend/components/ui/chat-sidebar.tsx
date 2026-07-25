import {
  ChevronDownIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

const savedItems = [
  { title: "ChatrAI", initial: "C", tone: "blue" },
  { title: "Image of sun", image: true, tone: "orange" },
  { title: "Data Analyst", initial: "D", tone: "purple" },
];

const recentSections = [
  {
    title: "Today",
    items: [
      "How can I improve my time management?",
      "What's the best way to learn a new skill?",
      "How do I start investing in stocks as a beginner?",
    ],
  },
  {
    title: "Yesterday",
    items: [
      "What are the benefits of daily exercise for focus?",
      "What's the difference between a UI designer and UX designer?",
    ],
  },
];

const toneClasses: Record<string, string> = {
  blue: "bg-blue-50 text-blue-500",
  orange: "bg-orange-50 text-orange-500",
  purple: "bg-purple-50 text-purple-500",
};

export function ChatSidebar() {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-gray-100 bg-white lg:flex">
      <div className="flex items-center justify-between p-4">
        <h2 className="font-semibold text-gray-900">Chat</h2>
        <IconButton className="size-8" label="Search chats">
          <SearchIcon className="size-4" />
        </IconButton>
      </div>

      <div className="mb-6 px-4">
        <Button className="w-full py-2.5 text-sm" variant="primary">
          <PlusIcon className="size-4" />
          New Chat
          <SparklesIcon className="ml-1 size-3" />
        </Button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-2">
        <section>
          <div className="mb-2 flex items-center px-2 text-xs font-medium uppercase tracking-wider text-gray-400">
            <StarIcon className="mr-1.5 size-3" />
            Saved
          </div>
          <div className="space-y-1">
            {savedItems.map((item) => (
              <button
                className="group flex w-full items-center justify-between rounded-lg p-2 text-sm hover:bg-gray-50"
                key={item.title}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                      toneClasses[item.tone],
                    )}
                  >
                    {item.image ? <ImageIcon className="size-3" /> : item.initial}
                  </span>
                  <span className="truncate text-gray-700">{item.title}</span>
                </span>
                <MoreHorizontalIcon className="size-4 shrink-0 text-gray-300 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </section>

        {recentSections.map((section) => (
          <section key={section.title}>
            <div className="mb-2 flex items-center justify-between px-2 text-xs font-medium text-gray-400">
              <span>{section.title}</span>
              <ChevronDownIcon className="size-3" />
            </div>
            <div className="space-y-1">
              {section.items.map((item) => (
                <button
                  className="w-full truncate rounded-lg p-2 text-left text-sm text-gray-600 hover:bg-gray-50"
                  key={item}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="border-t border-gray-100 p-4">
        <Button className="w-full py-2.5 text-sm" variant="primary">
          Upgrade to Pro
        </Button>
      </div>
    </aside>
  );
}
