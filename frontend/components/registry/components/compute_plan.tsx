import { z } from "zod";
import { CloudProviderLogo } from "@/components/ui/cloud-provider-logo";
import { AlertTriangleIcon } from "@/components/ui/icons";
import { defaultRegistry } from "../registry";

export const HIGH_COST_MONTHLY_USD = 500;

export const computePlanSchema = z.object({
  service: z.string(),
  provider: z.enum(["aws", "azure", "gcp"]).optional(),
  instanceType: z.string().optional(),
  replicaCount: z.number().default(1),
  autoScaling: z
    .object({
      min: z.coerce.number(),
      max: z.coerce.number(),
      desired: z.coerce.number().optional(),
      targetCpuUtilization: z.coerce.number().optional(),
    })
    .optional(),
  os: z.string().optional(),
  architecture: z.enum(["x86_64", "arm64"]).optional(),
  vcpu: z.coerce.number().optional(),
  memoryGb: z.coerce.number().optional(),
  hourlyCostUsd: z.coerce.number().optional(),
  monthlyCostUsd: z.coerce.number().optional(),
  reservation: z.enum(["reserved", "on-demand", "spot"]).optional(),
  policyNotes: z.array(z.string()).optional(),
});

export type ComputePlanData = z.infer<typeof computePlanSchema>;

export type ComputePlanState = "loading" | "default" | "error";

export type ManifestResourceLike = {
  name: string;
  type?: string;
  properties: Record<string, string>;
};

const ARCHITECTURES = ["x86_64", "arm64"] as const;
const RESERVATIONS = ["reserved", "on-demand", "spot"] as const;

function pickString(
  properties: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function pickNumber(
  properties: Record<string, string>,
  ...keys: string[]
): number | undefined {
  const raw = pickString(properties, ...keys);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function computePlanFromResource(
  resource: ManifestResourceLike,
  provider?: "aws" | "azure" | "gcp",
): unknown {
  const properties = resource.properties;
  const hourly = pickNumber(properties, "hourlyCostUsd", "hourly_cost_usd");
  const monthly =
    pickNumber(properties, "monthlyCostUsd", "monthly_cost_usd") ??
    (hourly !== undefined ? hourly * 730 : undefined);
  const minNodes = pickNumber(properties, "minNodes", "min_nodes");
  const maxNodes = pickNumber(properties, "maxNodes", "max_nodes");

  return {
    service: resource.name,
    provider,
    instanceType: pickString(properties, "instanceType", "instance_type"),
    replicaCount: pickNumber(properties, "count", "replicaCount", "replicas") ?? 1,
    autoScaling:
      minNodes !== undefined && maxNodes !== undefined
        ? {
            min: minNodes,
            max: maxNodes,
            desired: pickNumber(properties, "desiredNodes", "desired_nodes"),
          }
        : undefined,
    os: pickString(properties, "os", "operatingSystem", "operating_system"),
    architecture: pickEnum(
      pickString(properties, "architecture", "arch"),
      ARCHITECTURES,
    ),
    vcpu: pickNumber(properties, "vcpu", "vcpus"),
    memoryGb: pickNumber(properties, "memoryGb", "memory_gb"),
    hourlyCostUsd: hourly,
    monthlyCostUsd: monthly,
    reservation: pickEnum(
      pickString(properties, "reservation"),
      RESERVATIONS,
    ),
  };
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <span className="text-gray-400">{label}</span>
      <p className="font-semibold text-gray-800">{value}</p>
    </div>
  );
}

function ComputePlanSkeleton() {
  return (
    <div
      data-testid="compute-plan-skeleton"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="mt-2 h-4 w-40" />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-10 w-full" key={`spec-${index}`} />
        ))}
      </div>
      <Skeleton className="mt-4 h-3 w-28" />
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton className="h-10 w-full" key={`sizing-${index}`} />
        ))}
      </div>
    </div>
  );
}

function ComputePlanError({ errorMessage }: { errorMessage?: string }) {
  return (
    <div
      data-testid="compute-plan-error"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
    >
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Compute plan unavailable</p>
          <p className="mt-1 text-xs leading-relaxed">
            {errorMessage ??
              "The compute plan could not be loaded. It may have been updated or removed."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ComputePlanComponent({
  data,
  state = "default",
  errorMessage,
}: {
  data?: ComputePlanData;
  state?: ComputePlanState;
  errorMessage?: string;
}) {
  if (state === "error") {
    return <ComputePlanError errorMessage={errorMessage} />;
  }

  if (state === "loading" || !data) {
    return <ComputePlanSkeleton />;
  }

  const warnings: string[] = [];
  if (data.reservation !== undefined && data.reservation !== "reserved") {
    warnings.push(
      `Unreserved instance (${data.reservation}) — consider reserved pricing to reduce compute cost.`,
    );
  }
  if (
    data.monthlyCostUsd !== undefined &&
    data.monthlyCostUsd >= HIGH_COST_MONTHLY_USD
  ) {
    warnings.push(
      `High-cost configuration — estimated $${data.monthlyCostUsd.toFixed(2)}/mo exceeds the $${HIGH_COST_MONTHLY_USD}/mo review threshold.`,
    );
  }
  warnings.push(...(data.policyNotes ?? []));

  const hasSpecs =
    data.vcpu !== undefined ||
    data.memoryGb !== undefined ||
    data.hourlyCostUsd !== undefined ||
    data.monthlyCostUsd !== undefined;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-500">
          Compute Plan
        </span>
        <div className="flex items-center gap-2">
          {data.provider ? (
            <CloudProviderLogo provider={data.provider} size="sm" />
          ) : null}
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
            {data.replicaCount} {data.replicaCount === 1 ? "Replica" : "Replicas"}
          </span>
        </div>
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">{data.service}</h3>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {data.instanceType ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
            {data.instanceType}
          </span>
        ) : null}
        {data.os ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase text-gray-700">
            {data.os}
          </span>
        ) : null}
        {data.architecture ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase text-gray-700">
            {data.architecture}
          </span>
        ) : null}
      </div>

      {hasSpecs ? (
        <div className="mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Specifications
          </span>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {data.vcpu !== undefined ? (
              <StatTile label="vCPU" value={String(data.vcpu)} />
            ) : null}
            {data.memoryGb !== undefined ? (
              <StatTile label="Memory" value={`${data.memoryGb} GB`} />
            ) : null}
            {data.hourlyCostUsd !== undefined ? (
              <StatTile label="Hourly" value={`$${data.hourlyCostUsd.toFixed(4)}/hr`} />
            ) : null}
            {data.monthlyCostUsd !== undefined ? (
              <StatTile label="Monthly" value={`$${data.monthlyCostUsd.toFixed(2)}/mo`} />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Sizing &amp; Scaling
        </span>
        {data.autoScaling ? (
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <StatTile label="Min Nodes" value={String(data.autoScaling.min)} />
            <StatTile label="Max Nodes" value={String(data.autoScaling.max)} />
            <StatTile
              label="Desired Nodes"
              value={
                data.autoScaling.desired !== undefined
                  ? String(data.autoScaling.desired)
                  : "—"
              }
            />
          </div>
        ) : (
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <StatTile label="Nodes" value={String(data.replicaCount)} />
          </div>
        )}
      </div>

      {warnings.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <ul className="space-y-1">
            {warnings.map((warning) => (
              <li
                className="flex items-start gap-2 text-xs text-amber-900"
                key={warning}
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span className="leading-relaxed">{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "compute_plan",
  version: "1.0",
  schema: computePlanSchema,
  component: ComputePlanComponent,
});
