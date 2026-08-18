import { z } from "zod";
import { defaultRegistry } from "../registry";

export const monitoringCardSchema = z.object({
  service: z.string(),
  metrics: z.array(
    z.object({
      name: z.string(),
      unit: z.string(),
      threshold: z.string().optional(),
    }),
  ),
  alertEndpoints: z.array(z.string()).optional(),
  logRetentionDays: z.number().optional(),
  dashboardEnabled: z.boolean().default(true),
});

export type MonitoringCardData = z.infer<typeof monitoringCardSchema>;

export function MonitoringCardComponent({ data }: { data: MonitoringCardData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
          Observability &amp; Monitoring
        </span>
        <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
          {data.service}
        </span>
      </div>

      <div className="mt-3 flex gap-2 text-xs">
        {data.logRetentionDays !== undefined ? (
          <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">
            Log Retention: <strong>{data.logRetentionDays} Days</strong>
          </span>
        ) : null}
        <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">
          Dashboard: <strong>{data.dashboardEnabled ? "Active" : "Disabled"}</strong>
        </span>
      </div>

      <div className="mt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Monitored Metrics ({data.metrics.length})
        </span>
        <div className="mt-1.5 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {data.metrics.map((m) => (
            <div key={m.name} className="flex items-center justify-between p-2 text-xs">
              <span className="font-medium text-gray-800">{m.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-mono">[{m.unit}]</span>
                {m.threshold ? (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                    Threshold: {m.threshold}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "monitoring_card",
  version: "1.0",
  schema: monitoringCardSchema,
  component: MonitoringCardComponent,
});
