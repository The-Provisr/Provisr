import { z } from "zod";
import { defaultRegistry } from "../registry";

export const cloudStateSchema = z.object({
  cloudAccountId: z.string(),
  provider: z.enum(["aws", "azure", "gcp"]),
  syncedAt: z.string(),
  totalResources: z.number(),
  healthyCount: z.number(),
  unhealthyCount: z.number(),
});

export type CloudStateData = z.infer<typeof cloudStateSchema>;

export function CloudStateComponent({ data }: { data: CloudStateData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
          Live Cloud Inventory State
        </span>
        <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-semibold uppercase text-sky-700">
          {data.provider}
        </span>
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Account: <span className="font-mono text-gray-600">{data.cloudAccountId}</span>
        </h3>
        <span className="text-[11px] text-gray-400">Synced: {data.syncedAt}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-gray-50 p-2">
          <span className="text-gray-400">Total</span>
          <p className="text-lg font-bold text-gray-800">{data.totalResources}</p>
        </div>
        <div className="rounded-lg bg-green-50 p-2">
          <span className="text-green-600">Healthy</span>
          <p className="text-lg font-bold text-green-700">{data.healthyCount}</p>
        </div>
        <div className="rounded-lg bg-red-50 p-2">
          <span className="text-red-600">Unhealthy</span>
          <p className="text-lg font-bold text-red-700">{data.unhealthyCount}</p>
        </div>
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "cloud_state",
  version: "1.0",
  schema: cloudStateSchema,
  component: CloudStateComponent,
});
