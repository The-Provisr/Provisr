import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ui/chat-composer";
import { ChatSidebar } from "@/components/ui/chat-sidebar";
import { OpportunitiesTable } from "@/components/ui/data-table";
import {
  CopyIcon,
  RotateCcwIcon,
  SettingsIcon,
  SparklesIcon,
  ThumbsDownIcon,
  UploadIcon,
  VolumeIcon,
} from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { MessageBubble } from "@/components/ui/message-bubble";
import { NavigationRail } from "@/components/ui/navigation-rail";

export default function ChatPage() {
  return (
    <main className="flex h-screen overflow-hidden bg-gray-50 font-sans text-gray-800">
      <NavigationRail />
      <ChatSidebar />

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-50 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-gray-900">Provisr GPT</h1>
            <Badge>Plus</Badge>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button className="hidden sm:inline-flex" variant="secondary">
              Configuration
              <SettingsIcon className="size-3.5 text-gray-500" />
            </Button>
            <Button className="hidden sm:inline-flex" variant="secondary">
              Share
              <UploadIcon className="size-3.5 text-gray-500" />
            </Button>
            <Button variant="primary">
              New Chat
              <SparklesIcon className="size-3" />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
          <div className="mx-auto max-w-[850px] space-y-12">
            <MessageBubble>
              What are the best open opportunities by company size?
            </MessageBubble>

            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Here&apos;s a detailed breakdown of the best opportunities by
                company size:
              </p>

              <OpportunitiesTable />

              <p className="text-sm leading-relaxed text-gray-500">
                Company size significantly impacts the types of opportunities
                available. Startups are ideal for those seeking rapid growth and
                willing to take risks, while large corporations provide
                stability and long-term benefits.
              </p>

              <div className="flex items-center gap-4 pt-2 text-gray-400">
                <IconButton className="size-6" label="Read response aloud">
                  <VolumeIcon className="size-4" />
                </IconButton>
                <IconButton className="size-6" label="Copy response">
                  <CopyIcon className="size-4" />
                </IconButton>
                <IconButton className="size-6" label="Dislike response">
                  <ThumbsDownIcon className="size-4" />
                </IconButton>
                <IconButton className="size-6" label="Regenerate response">
                  <RotateCcwIcon className="size-4" />
                </IconButton>
              </div>
            </div>
          </div>
        </div>

        <ChatComposer />
      </section>
    </main>
  );
}
