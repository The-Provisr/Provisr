import type { ComponentType, SVGProps } from "react";
import { z } from "zod";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BellIcon,
  MailIcon,
  WebhookIcon,
} from "@/components/ui/icons";
import { defaultRegistry } from "../registry";

import { monitoringCardSchema, notificationTargetSchema } from "@provisr/shared-contracts";
export { monitoringCardSchema, notificationTargetSchema } from "@provisr/shared-contracts";

export type MonitoringCardData = z.infer<typeof monitoringCardSchema>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

export type MonitoringCardState = "loading" | "default" | "error";

const TARGET_META: Record<
  NotificationTarget["type"],
  { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  sns: { label: "SNS", Icon: BellIcon },
  email: { label: "Email", Icon: MailIcon },
  webhook: { label: "Webhook", Icon: WebhookIcon },
};

// Webhook URLs often embed secrets in the path or query (e.g. Slack/Teams
// hooks), so only HTTP(S) origins are shown.
export function formatDestination(target: NotificationTarget): string {
  if (target.type !== "webhook") return target.destination;

  let url: URL;
  try {
    url = new URL(target.destination);
  } catch {
    return "Unrecognized webhook URL";
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return "Unrecognized webhook URL";
  const redacted = url.pathname !== "/" || url.search !== "" || url.hash !== "";
  return `${url.origin}${redacted ? "/…" : ""}`;
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

function MonitoringCardSkeleton() {
  return (
    <div
      data-testid="monitoring-card-skeleton"
      role="status"
      aria-label="Loading monitoring configuration"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-36" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      <Skeleton className="mt-3 h-5 w-32" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton className="h-8 w-full" key={`row-${index}`} />
        ))}
      </div>
    </div>
  );
}

function MonitoringCardError({ errorMessage }: { errorMessage?: string }) {
  return (
    <div
      data-testid="monitoring-card-error"
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
    >
      <p className="text-sm font-semibold">Monitoring configuration unavailable</p>
      <p className="mt-1 text-xs leading-relaxed">
        {errorMessage ??
          "The monitoring configuration could not be loaded. It may have been updated or removed."}
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </span>
  );
}

export function MonitoringCardComponent({
  data,
  state = "default",
  errorMessage,
}: {
  data?: MonitoringCardData;
  state?: MonitoringCardState;
  errorMessage?: string;
}) {
  if (state === "error") {
    return <MonitoringCardError errorMessage={errorMessage} />;
  }

  if (state === "loading" || !data) {
    return <MonitoringCardSkeleton />;
  }

  return (
    <div
      data-testid="monitoring-card"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
          <ActivityIcon className="size-3.5 shrink-0" />
          Monitoring &amp; Logging
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="log-count"
            className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
          >
            {pluralize(data.logGroupNames.length, "Log Group", "Log Groups")}
          </span>
          <span
            data-testid="alarm-count"
            className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700"
          >
            {pluralize(data.alarmCount, "Alarm", "Alarms")}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <span
          data-testid="retention-badge"
          className="inline-flex rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700"
        >
          Retention:&nbsp;
          <strong>{pluralize(data.retentionDays, "day", "days")}</strong>
        </span>
      </div>

      <div className="mt-4">
        <SectionLabel>Log Groups</SectionLabel>
        {data.logGroupNames.length > 0 ? (
          <ul className="mt-1.5 divide-y divide-gray-100 rounded-lg border border-gray-100">
            {data.logGroupNames.map((name) => (
              <li
                className="break-all p-2 font-mono text-xs text-gray-800"
                data-testid="log-group"
                key={name}
              >
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-gray-500">No log groups configured.</p>
        )}
      </div>

      {data.metricNamespaces.length > 0 ? (
        <div className="mt-4">
          <SectionLabel>Metric Namespaces</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {data.metricNamespaces.map((namespace) => (
              <span
                className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700"
                key={namespace}
              >
                {namespace}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <SectionLabel>Notification Targets</SectionLabel>
        {data.notificationTargets.length > 0 ? (
          <ul className="mt-1.5 divide-y divide-gray-100 rounded-lg border border-gray-100">
            {data.notificationTargets.map((target) => {
              const { label, Icon } = TARGET_META[target.type];
              return (
                <li
                  className="flex items-center gap-2 p-2 text-xs"
                  data-testid={`notification-target-${target.type}`}
                  key={`${target.type}:${target.destination}`}
                >
                  <Icon className="size-3.5 shrink-0 text-gray-500" />
                  <span className="w-16 shrink-0 font-semibold text-gray-700">{label}</span>
                  <span className="break-all font-mono text-gray-800">
                    {formatDestination(target)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p
            data-testid="no-notification-targets"
            className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            No notification targets — alarms will not notify anyone.
          </p>
        )}
      </div>

      {data.policyNotes.length > 0 ? (
        <div
          data-testid="policy-notes"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <ul className="space-y-1">
            {data.policyNotes.map((note) => (
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
  type: "monitoring_card",
  version: "1.0",
  schema: monitoringCardSchema,
  component: MonitoringCardComponent,
});
