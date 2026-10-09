import { z } from "zod";
import { defaultRegistry } from "../registry";

export const architectureSummarySchema = z.object({
  title: z.string().optional(),
  provider: z.enum(["aws", "azure", "gcp", "unknown"]).default("unknown"),
  region: z.string(),
  environment: z.string(),
  estimatedCostUsd: z.number().optional(),
  resources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      tier: z.string().optional(),
      properties: z.record(z.string()).optional(),
    }),
  ),
  highlights: z.array(z.string()).optional(),
});

export type ArchitectureSummaryData = z.infer<typeof architectureSummarySchema>;

export function ArchitectureSummaryComponent({
  data,
}: {
  data: ArchitectureSummaryData;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">
            Architecture Plan
          </span>
          <h3 className="text-base font-semibold text-gray-900">
            {data.title || "Proposed Infrastructure Architecture"}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium uppercase text-gray-700">
            {data.provider}
          </span>
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {data.region}
          </span>
          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {data.environment}
          </span>
        </div>
      </div>

      {data.estimatedCostUsd !== undefined ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
          <span className="text-gray-500">Estimated Monthly Cost:</span>
          <span className="font-semibold text-gray-900">${data.estimatedCostUsd}/mo</span>
        </div>
      ) : null}

      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Planned Resources ({data.resources.length})
        </h4>
        <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {data.resources.map((res) => (
            <div key={res.id} className="flex items-center justify-between p-2.5 text-xs">
              <div>
                <span className="font-medium text-gray-800">{res.name}</span>
                <span className="ml-2 font-mono text-gray-400">({res.type})</span>
              </div>
              {res.tier ? (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                  {res.tier}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {data.highlights && data.highlights.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Highlights
          </h4>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-gray-600">
            {data.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "architecture_summary",
  version: "1.0",
  schema: architectureSummarySchema,
  component: ArchitectureSummaryComponent,
});
