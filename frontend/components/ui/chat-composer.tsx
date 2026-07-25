import {
  ArrowUpIcon,
  ChevronDownIcon,
  LinkIcon,
  MicIcon,
  SparklesIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

export function ChatComposer() {
  return (
    <footer className="bg-white p-4 sm:p-6">
      <div className="mx-auto max-w-[850px]">
        <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 shadow-sm transition-all focus-within:ring-2 focus-within:ring-blue-100">
          <label className="mb-3 ml-2 flex items-center gap-2 text-gray-400">
            <SparklesIcon className="size-4" />
            <span className="text-sm">Ask me anything...</span>
            <input className="sr-only" aria-label="Message" />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button className="bg-white px-3 py-1.5" variant="secondary">
              Select Source
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
              <Button className="px-6 py-2.5" variant="primary">
                <ArrowUpIcon className="size-3.5" />
                Send
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-[10px] text-gray-400">
          Centra may display inaccurate info, so please double check the response.
          <a className="ml-1 underline hover:text-gray-600" href="#">
            Your Privacy &amp; Provisr GPT
          </a>
        </div>
      </div>
    </footer>
  );
}
