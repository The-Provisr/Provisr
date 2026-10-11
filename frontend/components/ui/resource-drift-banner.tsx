import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, ShieldCheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type ResourceDriftBannerProps = {
  driftCount: number;
  onViewDriftReport?: () => void;
};

export function ResourceDriftBanner({
  driftCount,
  onViewDriftReport,
}: ResourceDriftBannerProps) {
  const hasDrift = driftCount > 0;

  return (
    <section
      aria-label={hasDrift ? "Configuration drift detected" : "All resources in sync"}
      className={cn(
        "rounded-lg border p-4",
        hasDrift ? "border-red-200 bg-red-50" : "border-green-100 bg-green-50",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {hasDrift ? (
          <AlertTriangleIcon className="size-5 text-red-900" />
        ) : (
          <ShieldCheckIcon className="size-5 text-green-700" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-sm font-semibold",
              hasDrift ? "text-red-900" : "text-green-700",
            )}
          >
            {hasDrift
              ? "Configuration drift detected"
              : "All resources in sync"}
          </div>
          <div className="mt-0.5 text-xs text-gray-600">
            {hasDrift
              ? `${driftCount} resource${driftCount === 1 ? "" : "s"} out of sync with the last planned state.`
              : "Last state sync completed without drift."}
          </div>
        </div>
        {hasDrift && onViewDriftReport ? (
          <Button onClick={onViewDriftReport} variant="secondary">
            View drift report
          </Button>
        ) : null}
      </div>
    </section>
  );
}