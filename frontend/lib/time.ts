export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return "";
  }
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const yesterday = new Date(now.getTime() - 86_400_000);
    if (then.toDateString() === yesterday.toDateString()) {
      return "yesterday";
    }
    if (then.toDateString() === now.toDateString()) {
      return `${hours}h ago`;
    }
  }
  const year = then.getFullYear() === now.getFullYear() ? undefined : "numeric";
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year,
  });
}
