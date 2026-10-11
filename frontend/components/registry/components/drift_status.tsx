import { z } from "zod";
import { defaultRegistry } from "../registry";

export const driftStatusSchema = z.object({
  hasDrift: z.boolean(),
  lastCheckedAt: z.string(),
  driftedResources: z
    .array(
      z.object({
        resourceId: z.string(),
        resourceName: z.string().optional(),
        resourceType: z.string(),
        property: z.string(),
        expectedValue: z.string(),
        actualValue: z.string(),
      }),
    )
    .optional(),
});

export type DriftStatusData = z.infer<typeof driftStatusSchema>;

export function DriftStatusComponent({ data }: { data: DriftStatusData }) {
  return (
    <div
      className={`rounded-xl border p-5 shadow-xs ${
        data.hasDrift ? "border-amber-200 bg-amber-50/20" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          State Reconciler Drift Monitor
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            data.hasDrift
              ? "bg-amber-100 text-amber-800"
              : "bg-green-100 text-green-800"
          }`}
        >
          {data.hasDrift ? "Drift Detected" : "In Sync"}
        </span>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Last checked: {data.lastCheckedAt}
      </div>

      {data.driftedResources && data.driftedResources.length > 0 ? (
        <div className="mt-3 space-y-2">
          {data.driftedResources.map((dr, idx) => (
            <div key={idx} className="rounded-lg border border-amber-200 bg-white p-2.5 text-xs">
              <div className="font-mono font-medium text-gray-800">
                {dr.resourceName || dr.resourceId} ({dr.resourceType})
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                <div className="text-gray-600">
                  <span className="font-semibold text-gray-400">Expected: </span>
                  <span className="font-mono">{dr.expectedValue}</span>
                </div>
                <div className="text-amber-700">
                  <span className="font-semibold text-amber-500">Actual: </span>
                  <span className="font-mono font-medium">{dr.actualValue}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-600">
          No configuration drift detected against active state.
        </p>
      )}
    </div>
  );
}

defaultRegistry.register({
  type: "drift_status",
  version: "1.0",
  schema: driftStatusSchema,
  component: DriftStatusComponent,
});
