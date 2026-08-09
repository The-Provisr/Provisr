import type { ComponentProps, ReactNode } from "react";
import type {
  ArchitectureResourceType,
  ArchitectureSummaryProps,
  KnownArchitectureResourceType,
} from "@/lib/architecture/types";
import { CloudProviderLogo } from "@/components/ui/cloud-provider-logo";
import {
  AlertTriangleIcon,
  DatabaseIcon,
  GaugeIcon,
  HardDriveIcon,
  NetworkIcon,
  ServerStackIcon,
  TerminalSquareIcon,
  ZapIcon,
} from "@/components/ui/icons";

type IconComponent = (props: ComponentProps<typeof ServerStackIcon>) => ReactNode;

const resourceIcons: Record<KnownArchitectureResourceType, IconComponent> = {
  compute: ServerStackIcon,
  database: DatabaseIcon,
  storage: HardDriveIcon,
  network: NetworkIcon,
  monitoring: GaugeIcon,
  loadbalancer: ZapIcon,
};

const FALLBACK_ICON: IconComponent = TerminalSquareIcon;

function ResourceIcon({ type }: { type: ArchitectureResourceType }) {
  const Icon = resourceIcons[type as KnownArchitectureResourceType] ?? FALLBACK_ICON;
  return <Icon className="size-4 text-gray-500" />;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-gray-100 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
      {children}
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </h4>
  );
}

function NoneIdentified() {
  return <p className="mt-2 text-xs text-gray-500">None identified</p>;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

export function ArchitectureSummary({
  payload,
  state = "default",
  onClarify,
}: ArchitectureSummaryProps) {
  if (state === "loading" || !payload) {
    return (
      <div
        data-testid="architecture-summary-skeleton"
        className="max-w-[480px] rounded-lg border border-gray-100 bg-white p-4"
      >
        <div className="flex items-center gap-2">
          <Skeleton className="size-8" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="mt-4 h-3 w-20" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-3/4" />
      </div>
    );
  }

  const isEmpty =
    payload.resources.length === 0 &&
    payload.assumptions.length === 0 &&
    payload.unknowns.length === 0 &&
    payload.warnings.length === 0;

  if (isEmpty) {
    return (
      <div className="max-w-[480px] rounded-lg border border-gray-100 bg-white p-4">
        <p className="text-sm font-medium text-white">Architecture summary</p>
        <p className="mt-2 text-xs text-gray-500">None identified</p>
      </div>
    );
  }

  return (
    <div className="max-w-[480px] rounded-lg border border-gray-100 bg-white p-4">
      <div className="flex items-center gap-2">
        <CloudProviderLogo provider={payload.provider} size="sm" />
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{payload.region}</Badge>
          <Badge>{payload.environment}</Badge>
        </div>
      </div>

      <section className="mt-4">
        <Eyebrow>
          {payload.resourceCount > 0
            ? `${payload.resourceCount} resources`
            : "Resources"}
        </Eyebrow>
        {payload.resources.length === 0 ? (
          <NoneIdentified />
        ) : (
          <ul className="mt-2 space-y-2">
            {payload.resources.map((resource) => (
              <li
                className="flex items-center gap-2 text-sm text-white"
                key={`${resource.type}-${resource.count}`}
              >
                <ResourceIcon type={resource.type} />
                <span>
                  {resource.count}x {capitalize(resource.type)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <Eyebrow>Assumptions</Eyebrow>
        {payload.assumptions.length === 0 ? (
          <NoneIdentified />
        ) : (
          <ol className="mt-2 list-decimal space-y-2 pl-4 text-sm leading-relaxed text-gray-500">
            {payload.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-4">
        <Eyebrow>Unknowns</Eyebrow>
        {payload.unknowns.length === 0 ? (
          <NoneIdentified />
        ) : (
          <ul className="mt-2 space-y-2">
            {payload.unknowns.map((unknown) => (
              <li
                className="flex items-center justify-between gap-3 text-sm text-white"
                key={unknown}
              >
                <span className="min-w-0 truncate">{unknown}</span>
                {onClarify ? (
                  <button
                    type="button"
                    onClick={() => onClarify(unknown)}
                    className="shrink-0 text-xs font-semibold text-blue-500"
                  >
                    Clarify
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <Eyebrow>Warnings</Eyebrow>
        {payload.warnings.length === 0 ? (
          <NoneIdentified />
        ) : (
          <ul className="mt-2 space-y-2">
            {payload.warnings.map((warning) => (
              <li
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                key={warning}
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span className="leading-relaxed">{warning}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
