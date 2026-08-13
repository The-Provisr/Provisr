import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NavigationRail } from "@/components/ui/navigation-rail";
import { cn } from "@/lib/cn";

type AppShellProps = {
  children: ReactNode;
  sidebar?: ReactNode;
};

type PageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
};

type SectionCardProps = {
  children: ReactNode;
  className?: string;
  title?: string;
  eyebrow?: string;
};

type StatCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "blue" | "amber" | "green";
};

type TableProps = {
  columns: string[];
  rows: Array<Array<ReactNode>>;
};

type BarChartProps = {
  data: Array<{ label: string; value: number }>;
};

type PieChartProps = {
  segments: Array<{ label: string; value: number; color: string }>;
};

const toneClasses = {
  neutral: "border-gray-100 bg-white",
  blue: "border-blue-100 bg-blue-50",
  amber: "border-amber-100 bg-amber-50",
  green: "border-green-100 bg-green-50",
};

export const workspaceNavItems = [
  { label: "Overview", href: "/workspace" },
  { label: "Insights", href: "/workspace/insights" },
  { label: "Policies", href: "/policy" },
  { label: "Cloud Accounts", href: "/workspace/cloud-accounts" },
  { label: "Team", href: "/workspace/team" },
  { label: "Billing & Usage", href: "/workspace/billing" },
  { label: "Workspace Settings", href: "/workspace/settings" },
];

export function AppShell({ children, sidebar }: AppShellProps) {
  return (
    <main className="flex h-screen overflow-hidden bg-gray-50 font-sans text-gray-800">
      <NavigationRail />
      {sidebar}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {children}
      </section>
    </main>
  );
}

export function PageHeader({ actions, description, title }: PageHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-50 px-4 sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate font-bold text-gray-900">{title}</h1>
        <p className="mt-0.5 truncate text-xs text-gray-500">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">{children}</div>;
}

export function SectionCard({ children, className, eyebrow, title }: SectionCardProps) {
  return (
    <section className={cn("rounded-lg border border-gray-100 bg-white p-4 shadow-sm", className)}>
      {eyebrow ? (
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {eyebrow}
        </div>
      ) : null}
      {title ? <h2 className="mt-1 text-sm font-semibold text-gray-900">{title}</h2> : null}
      <div className={title || eyebrow ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

export function StatCard({ detail, label, tone = "neutral", value }: StatCardProps) {
  return (
    <div className={cn("rounded-lg border p-4", toneClasses[tone])}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {detail ? <div className="mt-1 text-xs text-gray-500">{detail}</div> : null}
    </div>
  );
}

export function DataTable({ columns, rows }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400">
            {columns.map((column) => (
              <th className="px-3 py-3 font-semibold" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td className="px-3 py-3 align-top text-gray-700" key={cellIndex}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatCardProps["tone"] }) {
  const classes = {
    neutral: "border-gray-200 bg-gray-100 text-gray-600",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    green: "border-green-100 bg-green-50 text-green-700",
  };

  return <Badge className={classes[tone]}>{children}</Badge>;
}

export function WorkspaceSidebar({ active }: { active: string }) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-gray-100 bg-white p-4 lg:flex">
      <div className="mb-6">
        <div className="text-sm font-semibold text-gray-900">Acme Platform</div>
        <div className="mt-0.5 text-xs text-gray-500">Production workspace</div>
      </div>
      <nav className="space-y-1">
        {workspaceNavItems.map((item) => (
          <Link
            className={cn(
              "block rounded-lg px-3 py-2 text-sm font-medium",
              active === item.label
                ? "bg-slate-900 text-white"
                : "text-gray-600 hover:bg-gray-50",
            )}
            href={item.href}
            key={item.label}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

export function MiniBarChart({ data }: BarChartProps) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <div className="flex h-32 items-end gap-2">
      {data.map((item) => (
        <div className="flex flex-1 flex-col items-center gap-2" key={item.label}>
          <div
            className="w-full rounded-t bg-slate-900"
            style={{ height: `${Math.max((item.value / maxValue) * 100, 8)}%` }}
          />
          <span className="text-[10px] text-gray-400">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniLineChart({ data }: { data: number[] }) {
  const points = data
    .map((value, index) => `${(index / (data.length - 1)) * 100},${100 - value}`)
    .join(" ");

  return (
    <svg className="h-32 w-full text-slate-900" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline fill="none" points={points} stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

export function ProviderPieChart({ segments }: PieChartProps) {
  let current = 0;
  const stops = segments.map((segment) => {
    const start = current;
    current += segment.value;
    return `${segment.color} ${start}% ${current}%`;
  });
  const style = { "--pie": `conic-gradient(${stops.join(", ")})` } as CSSProperties;

  return (
    <div className="flex items-center gap-4">
      <div className="size-28 rounded-full" style={{ background: "var(--pie)", ...style }} />
      <div className="space-y-2">
        {segments.map((segment) => (
          <div className="flex items-center gap-2 text-xs text-gray-600" key={segment.label}>
            <span className="size-2 rounded-full" style={{ backgroundColor: segment.color }} />
            {segment.label} {segment.value}%
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyAction({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Button variant="secondary">
      <Link href={href}>{children}</Link>
    </Button>
  );
}
