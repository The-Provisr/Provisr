import type { ComponentProps, JSX, ReactNode } from "react";
import { z } from "zod";
import {
  AlertTriangleIcon,
  DatabaseIcon,
  GlobeIcon,
  LockIcon,
  LockOpenIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from "@/components/ui/icons";
import { defaultRegistry } from "../registry";

// Security fields and backup retention are required with no defaults: a payload
// that omits them must fail validation instead of rendering as if it were safe.
export const databaseConfigSchema = z.object({
  engine: z.string().min(1),
  version: z.string().optional(),
  instanceClass: z.string().optional(),
  allocatedStorageGb: z.number().positive(),
  maxAllocatedStorageGb: z.number().positive().optional(),
  storageType: z.string().optional(),
  multiAz: z.boolean().default(false),
  backupRetentionDays: z.number().int().min(0),
  maintenanceWindow: z.string().optional(),
  storageEncrypted: z.boolean(),
  publiclyAccessible: z.boolean(),
  deletionProtection: z.boolean(),
});

export type DatabaseConfigData = z.infer<typeof databaseConfigSchema>;

export type DatabaseConfigState = "loading" | "default";

export type DatabaseRiskSeverity = "critical" | "warning";

export interface DatabaseRisk {
  id: "unencrypted" | "public" | "deletion_protection_off" | "no_backups";
  severity: DatabaseRiskSeverity;
  title: string;
  detail: string;
}

/** Critical risks first, then warnings. */
export function getDatabaseRisks(data: DatabaseConfigData): DatabaseRisk[] {
  const risks: DatabaseRisk[] = [];
  if (!data.storageEncrypted) {
    risks.push({
      id: "unencrypted",
      severity: "critical",
      title: "Storage is not encrypted",
      detail: "Data at rest will be stored unencrypted.",
    });
  }
  if (data.publiclyAccessible) {
    risks.push({
      id: "public",
      severity: "critical",
      title: "Publicly accessible",
      detail: "This database will be reachable from the public internet.",
    });
  }
  if (!data.deletionProtection) {
    risks.push({
      id: "deletion_protection_off",
      severity: "warning",
      title: "Deletion protection is off",
      detail: "The database can be deleted without an extra safeguard.",
    });
  }
  if (data.backupRetentionDays === 0) {
    risks.push({
      id: "no_backups",
      severity: "warning",
      title: "Backups disabled",
      detail: "Backup retention is 0 days, so automated backups will not be kept.",
    });
  }
  return risks;
}

type IconComponent = (props: ComponentProps<typeof LockIcon>) => JSX.Element;
type Tone = "safe" | "critical" | "warning";

// Only classes remapped for the dark canvas in app/globals.css; other shades
// (e.g. text-red-700, bg-amber-100) render dark-on-dark.
const toneClasses: Record<Tone, { text: string; surface: string }> = {
  safe: { text: "text-green-700", surface: "border-green-200 bg-green-50" },
  critical: { text: "text-red-900", surface: "border-red-200 bg-red-50" },
  warning: { text: "text-amber-900", surface: "border-amber-200 bg-amber-50" },
};

const CARD_CLASS = "rounded-xl border border-gray-200 bg-white p-5 shadow-xs";

const engineNames: Record<string, string> = {
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  "aurora-postgresql": "Aurora PostgreSQL",
  "aurora-mysql": "Aurora MySQL",
  sqlserver: "SQL Server",
  oracle: "Oracle",
};

function engineDisplayName(engine: string): string {
  return engineNames[engine.toLowerCase()] ?? engine;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </span>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

function RiskCallout({ risk }: { risk: DatabaseRisk }) {
  const tone = toneClasses[risk.severity];
  return (
    <li
      data-severity={risk.severity}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone.surface} ${tone.text}`}
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="font-semibold">
          <span className="sr-only">
            {risk.severity === "critical" ? "Critical: " : "Warning: "}
          </span>
          {risk.title}
        </p>
        <p className="leading-relaxed">{risk.detail}</p>
      </div>
    </li>
  );
}

function SecurityIndicator({
  testId,
  label,
  status,
  tone,
  icon: Icon,
}: {
  testId: string;
  label: string;
  status: string;
  tone: Tone;
  icon: IconComponent;
}) {
  const classes = toneClasses[tone];
  return (
    <li
      data-testid={testId}
      data-tone={tone}
      className="flex items-center justify-between gap-3 py-2 text-xs"
    >
      <span className="text-gray-500">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-semibold ${classes.surface} ${classes.text}`}
      >
        <Icon className="size-3.5 shrink-0" />
        {status}
      </span>
    </li>
  );
}

function StorageBar({ allocatedGb, maxGb }: { allocatedGb: number; maxGb: number }) {
  const percent = Math.min(100, Math.round((allocatedGb / maxGb) * 100));
  return (
    <div
      role="progressbar"
      aria-label="Allocated storage"
      aria-valuemin={0}
      aria-valuemax={maxGb}
      aria-valuenow={allocatedGb}
      aria-valuetext={`${allocatedGb} GB of ${maxGb} GB`}
      className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100"
    >
      {/* bg-white is remapped to a dark surface, so the fill uses the ink token directly. */}
      <div
        className="h-full rounded-full"
        style={{ width: `${percent}%`, backgroundColor: "var(--provisr-ink)" }}
      />
    </div>
  );
}

function DatabaseConfigSkeleton() {
  return (
    <div data-testid="database-config-skeleton" aria-busy="true" className={CARD_CLASS}>
      <span className="sr-only">Loading database configuration</span>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="mt-4 h-2 w-full" />
      <Skeleton className="mt-3 h-3 w-3/4" />
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-full" />
    </div>
  );
}

function DatabaseConfigError() {
  return (
    <div
      data-testid="database-config-error"
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="text-sm font-semibold">Database configuration unavailable</p>
        <p className="mt-1 text-xs leading-relaxed">
          The configuration is missing or invalid, so its security settings cannot be shown. Do not
          confirm this resource until it can be reviewed.
        </p>
      </div>
    </div>
  );
}

export function DatabaseConfigComponent({
  data,
  state = "default",
}: {
  data?: DatabaseConfigData;
  state?: DatabaseConfigState;
}) {
  if (state === "loading") return <DatabaseConfigSkeleton />;

  const parsed = databaseConfigSchema.safeParse(data);
  if (!parsed.success) return <DatabaseConfigError />;

  const config = parsed.data;
  const risks = getDatabaseRisks(config);
  const retentionDays = config.backupRetentionDays;

  return (
    <div data-testid="database-config-card" className={CARD_CLASS}>
      {risks.length > 0 ? (
        <ul role="alert" aria-label="Risky database settings" className="mb-4 space-y-2">
          {risks.map((risk) => (
            <RiskCallout key={risk.id} risk={risk} />
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-900">
            <DatabaseIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <Eyebrow>Database Configuration</Eyebrow>
            <div className="flex items-baseline gap-2">
              <h3 className="truncate text-base font-semibold text-gray-900">
                {engineDisplayName(config.engine)}
              </h3>
              {config.version ? (
                <span className="font-mono text-xs text-gray-500">v{config.version}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {config.instanceClass ? (
            <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-900">
              {config.instanceClass}
            </span>
          ) : null}
          <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {config.multiAz ? "Multi-AZ" : "Single-AZ"}
          </span>
        </div>
      </div>

      <section className="mt-4">
        <Eyebrow>Storage &amp; Backup</Eyebrow>
        <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-gray-500">
            Allocated storage{config.storageType ? ` (${config.storageType})` : ""}
          </span>
          <span className="font-semibold text-gray-900">
            {config.maxAllocatedStorageGb
              ? `${config.allocatedStorageGb} GB of ${config.maxAllocatedStorageGb} GB`
              : `${config.allocatedStorageGb} GB · autoscaling off`}
          </span>
        </div>
        {config.maxAllocatedStorageGb ? (
          <StorageBar allocatedGb={config.allocatedStorageGb} maxGb={config.maxAllocatedStorageGb} />
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-gray-200 bg-gray-100 p-2">
            <dt className="text-gray-500">Backup retention</dt>
            <dd className="font-semibold text-gray-900">
              {retentionDays} {retentionDays === 1 ? "day" : "days"}
            </dd>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-100 p-2">
            <dt className="text-gray-500">Maintenance window</dt>
            <dd className="font-semibold text-gray-900">{config.maintenanceWindow || "Not set"}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-4">
        <Eyebrow>Security</Eyebrow>
        <ul className="mt-1 divide-y divide-gray-100">
          <SecurityIndicator
            testId="indicator-encryption"
            label="Encryption at rest"
            status={config.storageEncrypted ? "Encrypted" : "Not encrypted"}
            tone={config.storageEncrypted ? "safe" : "critical"}
            icon={config.storageEncrypted ? LockIcon : LockOpenIcon}
          />
          <SecurityIndicator
            testId="indicator-network"
            label="Network accessibility"
            status={config.publiclyAccessible ? "Public" : "Private"}
            tone={config.publiclyAccessible ? "critical" : "safe"}
            icon={config.publiclyAccessible ? GlobeIcon : ShieldCheckIcon}
          />
          <SecurityIndicator
            testId="indicator-deletion-protection"
            label="Deletion protection"
            status={config.deletionProtection ? "On" : "Off"}
            tone={config.deletionProtection ? "safe" : "warning"}
            icon={config.deletionProtection ? ShieldCheckIcon : ShieldOffIcon}
          />
        </ul>
      </section>
    </div>
  );
}

defaultRegistry.register({
  type: "database_config",
  version: "1.0",
  schema: databaseConfigSchema,
  component: DatabaseConfigComponent,
});
