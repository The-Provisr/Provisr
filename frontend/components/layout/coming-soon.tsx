import { SparklesIcon } from "@/components/ui/icons";

type ComingSoonProps = {
  /** Screen name shown as the heading. */
  title: string;
  /** Delivery week from the sprint plan, e.g. 9 → "Coming in Week 9". */
  week: number | string;
  /** One line describing what the screen will do once built. */
  description?: string;
};

/**
 * FE-M03 placeholder. Screens that exist in navigation but are not built yet
 * render this so every nav destination is reachable from day one; the task that
 * owns the screen replaces this component's usage (and nothing else).
 */
export function ComingSoon({ title, week, description }: ComingSoonProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className="w-full max-w-[420px] rounded-xl border border-gray-200 bg-white p-6 text-center shadow-xs"
        data-testid="coming-soon"
      >
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-500">
          <SparklesIcon className="size-5" />
        </span>
        <h2 className="mt-3 text-sm font-bold text-gray-900">{title}</h2>
        <p className="mt-1 text-xs font-medium uppercase tracking-wider text-blue-500">
          Coming in Week {week}
        </p>
        {description ? (
          <p className="mt-2 text-xs text-gray-500">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
