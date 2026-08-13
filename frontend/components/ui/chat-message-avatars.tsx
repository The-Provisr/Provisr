import { SparklesIcon } from "@/components/ui/icons";

function initials(name?: string): string {
  if (!name) {
    return "?";
  }
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserAvatar({ name }: { name?: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-400"
    >
      {initials(name)}
    </span>
  );
}

export function AssistantAvatar() {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-blue-500"
    >
      <SparklesIcon className="size-4" />
    </span>
  );
}
