"use client";

import { useId, useState } from "react";
import { z } from "zod";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  GlobeIcon,
  LockIcon,
} from "@/components/ui/icons";
import { defaultRegistry } from "../registry";

import { loadbalancerCardSchema } from "@provisr/shared-contracts";
export { loadbalancerCardSchema } from "@provisr/shared-contracts";

export type LoadbalancerCardData = z.infer<typeof loadbalancerCardSchema>;

export type LoadbalancerListener = LoadbalancerCardData["listeners"][number];

export type LoadbalancerTargetGroup = LoadbalancerCardData["targetGroups"][number];

export type LoadbalancerCardState = "loading" | "default" | "error";

export const LB_TYPE_LABELS: Record<LoadbalancerCardData["lbType"], string> = {
  ALB: "Application Load Balancer",
  NLB: "Network Load Balancer",
  AGW: "Application Gateway",
};

export const DEFAULT_APPROVAL_NOTE =
  "Review public exposure and policy results before apply.";

const TLS_PROTOCOLS = ["HTTPS", "TLS"];

export function isPubliclyExposed(
  data: Pick<LoadbalancerCardData, "scheme" | "publicExposure">,
): boolean {
  return data.scheme === "internet-facing" || data.publicExposure === true;
}

export function isTlsListener(listener: LoadbalancerListener): boolean {
  return TLS_PROTOCOLS.includes(listener.protocol.trim().toUpperCase());
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

function LoadbalancerCardSkeleton() {
  return (
    <div
      data-testid="loadbalancer-card-skeleton"
      role="status"
      aria-label="Loading load balancer"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-5 w-28" />
      </div>
      <Skeleton className="mt-2 h-4 w-40" />
      <Skeleton className="mt-3 h-6 w-64" />
      <Skeleton className="mt-4 h-3 w-20" />
      <div className="mt-1.5 space-y-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton className="h-8 w-full" key={`listener-${index}`} />
        ))}
      </div>
      <Skeleton className="mt-4 h-3 w-28" />
      <div className="mt-1.5 space-y-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton className="h-10 w-full" key={`target-group-${index}`} />
        ))}
      </div>
    </div>
  );
}

function LoadbalancerCardError({ errorMessage }: { errorMessage?: string }) {
  return (
    <div
      data-testid="loadbalancer-card-error"
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
    >
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Load balancer unavailable</p>
          <p className="mt-1 text-xs leading-relaxed">
            {errorMessage ??
              "The load balancer could not be loaded. It may have been updated or removed."}
          </p>
        </div>
      </div>
    </div>
  );
}

function SchemeBadge({ scheme }: { scheme: LoadbalancerCardData["scheme"] }) {
  const internetFacing = scheme === "internet-facing";

  return (
    <span
      data-testid="scheme-badge"
      className={
        internetFacing
          ? "flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800"
          : "flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-700"
      }
    >
      {internetFacing ? (
        <GlobeIcon className="size-3 shrink-0" />
      ) : (
        <LockIcon className="size-3 shrink-0" />
      )}
      {internetFacing ? "Internet-facing" : "Internal"}
    </span>
  );
}

function TrafficPath({ data }: { data: LoadbalancerCardData }) {
  const steps = [
    data.scheme === "internet-facing" ? "Internet" : "Private network",
    `${data.lbType} ${data.name}`,
    `${data.listeners.length} ${data.listeners.length === 1 ? "listener" : "listeners"}`,
    `${data.targetGroups.length} ${
      data.targetGroups.length === 1 ? "target group" : "target groups"
    }`,
  ];

  return (
    <ol
      aria-label="Traffic path"
      data-testid="traffic-path"
      className="mt-3 flex flex-wrap items-center gap-1.5 text-xs"
    >
      {steps.map((step, index) => (
        <li className="flex items-center gap-1.5" key={`${index}-${step}`}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-gray-400">
              →
            </span>
          ) : null}
          <span className="rounded-md border border-gray-100 bg-gray-50 px-2 py-0.5 font-medium text-gray-700">
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TargetGroupRow({ group }: { group: LoadbalancerTargetGroup }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <div className="rounded-lg border border-gray-100" data-testid="target-group">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs"
      >
        <span className="font-mono font-semibold text-gray-800">{group.name}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-gray-500">
            {group.protocol}:{group.port}
          </span>
          <ChevronDownIcon
            className={`size-3.5 shrink-0 text-gray-400 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>
      {expanded ? (
        <div
          id={panelId}
          className="grid grid-cols-2 gap-2 border-t border-gray-100 px-2.5 py-2 text-xs"
        >
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Health check path</span>
            <p className="font-mono font-semibold text-gray-800">
              {group.healthCheckPath ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Interval</span>
            <p className="font-semibold text-gray-800">
              {group.interval !== undefined ? `${group.interval}s` : "—"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LoadbalancerCardComponent({
  data,
  state = "default",
  errorMessage,
}: {
  data?: LoadbalancerCardData;
  state?: LoadbalancerCardState;
  errorMessage?: string;
}) {
  if (state === "error") {
    return <LoadbalancerCardError errorMessage={errorMessage} />;
  }

  if (state === "loading" || !data) {
    return <LoadbalancerCardSkeleton />;
  }

  const exposed = isPubliclyExposed(data);
  const policyNotes = Array.from(new Set(data.policyNotes));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
            Load Balancer
          </span>
          <span
            data-testid="lb-type-badge"
            className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700"
          >
            {data.lbType} · {LB_TYPE_LABELS[data.lbType]}
          </span>
        </div>
        <SchemeBadge scheme={data.scheme} />
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">{data.name}</h3>

      <TrafficPath data={data} />

      {exposed ? (
        <div
          data-testid="public-exposure-alert"
          role="note"
          className="mt-3 flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900"
        >
          <span className="flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            <AlertTriangleIcon className="size-3 shrink-0" />
            Public Exposure
          </span>
          <p className="text-xs leading-relaxed">
            {data.approvalNote ?? DEFAULT_APPROVAL_NOTE}
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Listeners ({data.listeners.length})
        </span>
        {data.listeners.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No listeners defined.</p>
        ) : (
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 font-semibold uppercase tracking-wider text-gray-400">
                  <th scope="col" className="pb-2">Port</th>
                  <th scope="col" className="pb-2">Protocol</th>
                  <th scope="col" className="pb-2">SSL Policy</th>
                  <th scope="col" className="pb-2">Forwards to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.listeners.map((listener, index) => {
                  const tls = isTlsListener(listener);

                  return (
                    <tr key={`${listener.protocol}-${listener.port}-${index}`}>
                      <td className="py-2.5 font-mono font-medium text-gray-800">
                        {listener.port}
                      </td>
                      <td className="py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-gray-800">{listener.protocol}</span>
                          {tls ? (
                            <span className="rounded bg-green-100 px-1 py-0.5 text-[9px] font-bold text-green-700">
                              TLS
                            </span>
                          ) : exposed ? (
                            <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-bold text-amber-700">
                              Unencrypted
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="py-2.5 font-mono text-gray-500">
                        {listener.sslPolicy ?? "—"}
                      </td>
                      <td className="py-2.5 font-mono text-gray-500">
                        {listener.targetGroup ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Target Groups ({data.targetGroups.length})
        </span>
        {data.targetGroups.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No target groups defined.</p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {data.targetGroups.map((group) => (
              <TargetGroupRow group={group} key={group.name} />
            ))}
          </div>
        )}
      </div>

      {policyNotes.length > 0 ? (
        <div
          data-testid="policy-notes"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <ul className="space-y-1">
            {policyNotes.map((note) => (
              <li className="flex items-start gap-2 text-xs text-amber-900" key={note}>
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span className="leading-relaxed">{note}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "loadbalancer_card",
  version: "1.0",
  schema: loadbalancerCardSchema,
  component: LoadbalancerCardComponent,
});
