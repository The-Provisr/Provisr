import { z } from "zod";
import { cn } from "@/lib/cn";
import { defaultRegistry } from "../registry";

import { costEstimateSchema } from "@provisr/shared-contracts";
export { costEstimateSchema } from "@provisr/shared-contracts";

export type CostEstimateData = z.infer<typeof costEstimateSchema>;

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

const confidenceStyles = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
} as const;

export function CostEstimateComponent({ data }: { data: CostEstimateData }) {
  if (data.state === "loading") {
    return (
      <section aria-label="Cost estimate" aria-busy="true" className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-gray-900">Cost estimate</h3>
        <p className="mt-2 text-sm text-gray-600">Estimating...</p>
        <div className="mt-4 space-y-3" aria-hidden="true">
          <div className="h-9 w-40 animate-pulse rounded bg-gray-100" />
          <div className="h-5 animate-pulse rounded bg-gray-100" />
          <div className="h-5 w-4/5 animate-pulse rounded bg-gray-100" />
        </div>
      </section>
    );
  }

  const chartDenominator = data.totalMonthlyEstimate ?? data.services.reduce((sum, service) => sum + service.monthly_cost, 0);

  return (
    <section aria-label="Cost estimate" className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Monthly cost estimate</span>
        {data.state === "partial" ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Partial estimate</span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {data.totalMonthlyEstimate !== undefined ? (
          <strong className="text-3xl font-bold tracking-tight text-gray-950">{formatCurrency(data.totalMonthlyEstimate, data.currency)}</strong>
        ) : (
          <strong className="text-xl font-semibold text-gray-700">Total not available</strong>
        )}
        <span className="text-xs text-gray-500">per month</span>
      </div>

      {data.state === "partial" ? (
        <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {data.partial_reasons?.length ? data.partial_reasons.join(" ") : "Some pricing data is unavailable. The values shown may be incomplete."}
        </div>
      ) : null}

      {data.requires_approval ? (
        <div role="note" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
          <strong className="block font-semibold">Approval required for this estimate</strong>
          {data.cost_approval_threshold !== undefined ? (
            <span className="mt-1 block">Approval threshold: {formatCurrency(data.cost_approval_threshold, data.currency)} per month.</span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Cost by service</h4>
        {data.services.length ? (
          <ul className="mt-2 space-y-3">
            {data.services.map((service, index) => {
              const proportionalWidth = chartDenominator > 0
                ? Math.min(100, Math.max(0, (service.monthly_cost / chartDenominator) * 100))
                : 0;
              return (
                <li key={`${service.service}-${index}`}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium text-gray-800">{service.service}</span>
                    <span className="flex items-baseline gap-2 text-gray-700">
                      <strong>{formatCurrency(service.monthly_cost, data.currency)}</strong>
                      <span className="text-gray-500">{service.percentage.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${service.service}: ${formatCurrency(service.monthly_cost, data.currency)}, ${service.percentage.toFixed(1)} percent of estimate`}>
                    <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${proportionalWidth}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-gray-500">No service breakdown is available.</p>
        )}
      </div>

      {data.assumptions.length ? (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Assumptions</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-gray-600">
            {data.assumptions.map((assumption, index) => <li key={`${assumption}-${index}`}>{assumption}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-xs">
        <span className="text-gray-500">Confidence</span>
        {data.confidence ? (
          <span className={cn("rounded-full px-2 py-1 font-semibold capitalize", confidenceStyles[data.confidence])}>{data.confidence}</span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-600">Not provided</span>
        )}
        {data.pricing_source ? <span className="text-gray-500">Source: <strong className="font-medium text-gray-700">{data.pricing_source}</strong></span> : null}
        {data.freshnessNote ? <span className="text-gray-500">Pricing freshness: <strong className="font-medium text-gray-700">{data.freshnessNote}</strong></span> : null}
      </div>

      {data.deltaPercentage !== undefined ? (
        <p className="mt-3 text-[11px] text-gray-500">
          {data.deltaPercentage > 0 ? `+${data.deltaPercentage}` : data.deltaPercentage}% vs current estimate
        </p>
      ) : null}
    </section>
  );
}

defaultRegistry.register({
  type: "cost_estimate",
  version: "1.0",
  schema: costEstimateSchema,
  component: CostEstimateComponent,
});
