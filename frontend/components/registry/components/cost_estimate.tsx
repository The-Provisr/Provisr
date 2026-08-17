import { z } from "zod";
import { defaultRegistry } from "../registry";

export const costEstimateSchema = z.object({
  currency: z.string().default("USD"),
  monthlyTotalUsd: z.number(),
  breakdown: z.array(
    z.object({
      category: z.string(),
      serviceName: z.string(),
      costUsd: z.number(),
      unit: z.string().optional(),
    }),
  ),
  previousMonthlyCostUsd: z.number().optional(),
  deltaPercentage: z.number().optional(),
});

export type CostEstimateData = z.infer<typeof costEstimateSchema>;

export function CostEstimateComponent({ data }: { data: CostEstimateData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
          Cost Estimation Breakdown
        </span>
        {data.deltaPercentage !== undefined ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              data.deltaPercentage > 0
                ? "bg-amber-50 text-amber-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {data.deltaPercentage > 0 ? `+${data.deltaPercentage}%` : `${data.deltaPercentage}%`} vs current
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900">${data.monthlyTotalUsd}</span>
        <span className="text-xs text-gray-500">/ month total estimated</span>
      </div>

      <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
        {data.breakdown.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between p-2.5 text-xs">
            <div>
              <span className="font-medium text-gray-800">{item.serviceName}</span>
              <span className="ml-2 text-gray-400">({item.category})</span>
            </div>
            <div className="flex items-center gap-1 font-semibold text-gray-900">
              ${item.costUsd}
              {item.unit ? <span className="font-normal text-gray-400">/{item.unit}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "cost_estimate",
  version: "1.0",
  schema: costEstimateSchema,
  component: CostEstimateComponent,
});
