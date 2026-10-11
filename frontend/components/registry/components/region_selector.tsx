import { z } from "zod";
import { defaultRegistry } from "../registry";

export const regionSelectorSchema = z.object({
  provider: z.enum(["aws", "azure", "gcp"]),
  selectedRegion: z.string(),
  availableRegions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      latencyMs: z.number().optional(),
      complianceCompliant: z.boolean().optional(),
    }),
  ),
  reasoning: z.string().optional(),
});

export type RegionSelectorData = z.infer<typeof regionSelectorSchema>;

export function RegionSelectorComponent({
  data,
}: {
  data: RegionSelectorData;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
          Target Region Selection
        </span>
        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold uppercase text-blue-700">
          {data.provider}
        </span>
      </div>

      <div className="mt-2">
        <span className="text-xs text-gray-500">Selected Region:</span>
        <h3 className="text-base font-semibold text-gray-900">{data.selectedRegion}</h3>
      </div>

      {data.reasoning ? (
        <p className="mt-1 text-xs text-gray-600">{data.reasoning}</p>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.availableRegions.map((reg) => (
          <div
            key={reg.id}
            className={`flex items-center justify-between rounded-lg border p-2.5 text-xs ${
              reg.id === data.selectedRegion
                ? "border-blue-500 bg-blue-50/40"
                : "border-gray-100 bg-gray-50/50"
            }`}
          >
            <div>
              <span className="font-semibold text-gray-800">{reg.name}</span>
              <p className="font-mono text-[11px] text-gray-400">{reg.id}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {reg.latencyMs ? (
                <span className="text-[10px] text-gray-500">{reg.latencyMs}ms</span>
              ) : null}
              {reg.complianceCompliant ? (
                <span className="rounded bg-green-100 px-1.5 py-0.2 text-[9px] font-semibold text-green-700">
                  Compliant
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "region_selector",
  version: "1.0",
  schema: regionSelectorSchema,
  component: RegionSelectorComponent,
});
