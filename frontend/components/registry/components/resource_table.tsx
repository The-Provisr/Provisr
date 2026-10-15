"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { CloudProviderLogo, type CloudProviderId } from "@/components/ui/cloud-provider-logo";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  DatabaseIcon,
  HardDriveIcon,
  NetworkIcon,
  SearchIcon,
  ServerStackIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { defaultRegistry } from "../registry";
import { resourceTableSchema } from "@provisr/shared-contracts";
export { resourceTableSchema } from "@provisr/shared-contracts";

export type ResourceTableData = z.infer<typeof resourceTableSchema>;
export type ResourceNavigationRequest = {
  type: "resource_navigation";
  target: "domain_card";
  resourceId: string;
  resourceName: string;
};

type ResourceRow = ResourceTableData["rows"][number];
type SortKey = "name" | "type" | "provider" | "region" | "dependsOn" | "warningCount" | "status";
type SortDirection = "asc" | "desc";
type FilterValue = "all" | string;

const providerNames: Record<CloudProviderId, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
};

function knownProvider(provider: string): provider is CloudProviderId {
  return provider === "aws" || provider === "azure" || provider === "gcp";
}

function ResourceTypeIcon({ type }: { type: string }) {
  const normalized = type.toLowerCase();
  const className = "size-4 shrink-0 text-gray-500";
  if (/database|rds|postgres|mysql|sql/.test(normalized)) return <DatabaseIcon className={className} aria-hidden="true" />;
  if (/network|vpc|vnet|subnet|firewall|load.?balanc/.test(normalized)) return <NetworkIcon className={className} aria-hidden="true" />;
  if (/storage|bucket|volume|blob/.test(normalized)) return <HardDriveIcon className={className} aria-hidden="true" />;
  return <ServerStackIcon className={className} aria-hidden="true" />;
}

function ResourceStatus({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (["ready", "live", "active", "applied", "complete", "completed"].includes(normalized)) {
    return <span className="inline-flex items-center gap-1.5 text-green-700"><CheckIcon className="size-4" aria-hidden="true" /><span>{status}</span></span>;
  }
  if (["failed", "error", "denied", "blocked"].includes(normalized)) {
    return <span className="inline-flex items-center gap-1.5 text-red-700"><BanIcon className="size-4" aria-hidden="true" /><span>{status}</span></span>;
  }
  if (["warning", "drifted", "attention"].includes(normalized)) {
    return <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangleIcon className="size-4" aria-hidden="true" /><span>{status}</span></span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-gray-600"><span className="size-2 rounded-full bg-gray-400" aria-hidden="true" /><span>{status}</span></span>;
}

function rowDomId(id: string) {
  return `resource-row-${encodeURIComponent(id)}`;
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /(password|secret|token|private.?key|access.?key|api.?key|credential)/i.test(key)
        ? "[REDACTED]"
        : redactSensitiveFields(entry),
    ]),
  );
}

function compareRows(left: ResourceRow, right: ResourceRow, key: SortKey) {
  if (key === "warningCount") return left.warningCount - right.warningCount;
  const leftValue = key === "dependsOn" ? left.dependsOn.join(", ") : key === "region" ? left.region ?? "" : String(left[key] ?? "");
  const rightValue = key === "dependsOn" ? right.dependsOn.join(", ") : key === "region" ? right.region ?? "" : String(right[key] ?? "");
  return leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });
}

export function ResourceTableComponent({
  data,
  onNavigateResource,
}: {
  data: ResourceTableData;
  onNavigateResource?: (request: ResourceNavigationRequest) => void;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterValue>("all");
  const [providerFilter, setProviderFilter] = useState<FilterValue>("all");
  const [regionFilter, setRegionFilter] = useState<FilterValue>("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "asc" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusResourceId, setFocusResourceId] = useState<string | null>(null);

  const filterOptions = useMemo(() => ({
    types: [...new Set(data.rows.map((row) => row.type))].sort((a, b) => a.localeCompare(b)),
    providers: [...new Set(data.rows.map((row) => row.provider))].sort((a, b) => a.localeCompare(b)),
    regions: [...new Set(data.rows.map((row) => row.region).filter((region): region is string => Boolean(region)))].sort((a, b) => a.localeCompare(b)),
  }), [data.rows]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = data.rows.filter((row) => {
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
      if (providerFilter !== "all" && row.provider !== providerFilter) return false;
      if (regionFilter !== "all" && row.region !== regionFilter) return false;
      if (!normalizedQuery) return true;
      const searchable = [row.name, row.type, row.provider, row.region ?? "", row.status, ...row.dependsOn].join(" ").toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
    });
    return filtered.sort((left, right) => {
      const result = compareRows(left, right, sort.key);
      return sort.direction === "asc" ? result : -result;
    });
  }, [data.rows, providerFilter, query, regionFilter, sort, typeFilter]);

  useEffect(() => {
    if (!focusResourceId) return;
    document.getElementById(rowDomId(focusResourceId))?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setFocusResourceId(null);
  }, [focusResourceId, visibleRows]);

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function navigateDependency(name: string) {
    const target = data.rows.find((row) => row.name === name || row.id === name);
    if (!target) return;
    setQuery("");
    setTypeFilter("all");
    setProviderFilter("all");
    setRegionFilter("all");
    setExpandedId(target.id);
    setFocusResourceId(target.id);
  }

  function handleNameClick(row: ResourceRow) {
    if (onNavigateResource) {
      onNavigateResource({ type: "resource_navigation", target: "domain_card", resourceId: row.id, resourceName: row.name });
      return;
    }
    setExpandedId(row.id);
    setFocusResourceId(row.id);
  }

  function sortButton(label: string, key: SortKey) {
    return (
      <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 text-left hover:text-gray-700">
        {label}
        <span aria-hidden="true" className="text-gray-400">{sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    );
  }

  if (data.rows.length === 0) {
    return <section aria-label="Manifest resources" className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs"><h3 className="text-sm font-semibold text-gray-900">{data.title ?? "Resources"}</h3><p className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No resources in the manifest yet.</p></section>;
  }

  return (
    <section aria-label="Manifest resources" className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">{data.title ?? `Resources (${data.rows.length})`}</h3>
        <span className="text-xs text-gray-500">{visibleRows.length} of {data.rows.length} resources</span>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(12rem,1fr)_repeat(3,minmax(8rem,auto))]">
        <label className="relative block">
          <span className="sr-only">Search resources</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-gray-400" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search resources" className="w-full rounded-md border border-gray-200 py-2 pl-9 pr-3 text-xs text-gray-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        </label>
        <label className="text-xs text-gray-500">Type
          <select aria-label="Filter by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-xs text-gray-800">
            <option value="all">All types</option>{filterOptions.types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">Provider
          <select aria-label="Filter by provider" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-xs text-gray-800">
            <option value="all">All providers</option>{filterOptions.providers.map((provider) => <option key={provider} value={provider}>{knownProvider(provider) ? providerNames[provider] : provider}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">Region
          <select aria-label="Filter by region" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-xs text-gray-800">
            <option value="all">All regions</option>{filterOptions.regions.map((region) => <option key={region} value={region}>{region}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3 max-h-[34rem] overflow-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[880px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500 shadow-[0_1px_0_0_#e5e7eb]">
            <tr>
              {(["name", "type", "provider", "region", "dependsOn"] as const).map((key) => (
                <th key={key} scope="col" aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2.5">{sortButton(key === "name" ? "Logical name" : key === "dependsOn" ? "Depends on" : key, key)}</th>
              ))}
              <th scope="col" aria-sort={sort.key === "warningCount" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2.5">{sortButton("Warnings", "warningCount")}</th>
              <th scope="col" aria-sort={sort.key === "status" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2.5">{sortButton("Status", "status")}</th>
              <th scope="col" className="px-3 py-2.5"><span className="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleRows.map((row) => {
              const expanded = expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr
                    id={rowDomId(row.id)}
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                    className={cn("cursor-pointer align-top hover:bg-blue-50/40", expanded && "bg-blue-50/30")}
                  >
                    <th scope="row" className="px-3 py-3 font-medium text-gray-900">
                      <button type="button" onClick={(event) => { event.stopPropagation(); handleNameClick(row); }} className="text-left text-blue-700 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-blue-500" aria-label={`Open domain card for ${row.name}`}>
                        {row.name}
                      </button>
                    </th>
                    <td className="px-3 py-3 text-gray-700"><span className="inline-flex items-center gap-2"><ResourceTypeIcon type={row.type} />{row.type}</span></td>
                    <td className="px-3 py-3 text-gray-700">{knownProvider(row.provider) ? <span className="inline-flex items-center gap-2"><CloudProviderLogo provider={row.provider} size="sm" /><span>{providerNames[row.provider]}</span></span> : <span className="inline-flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded bg-gray-100 text-[9px] font-bold text-gray-600">{row.provider.slice(0, 2).toUpperCase()}</span>{row.provider}</span>}</td>
                    <td className="px-3 py-3"><span className="rounded-full bg-indigo-50 px-2 py-1 font-mono text-[10px] text-indigo-800">{row.region ?? "—"}</span></td>
                    <td className="px-3 py-3 text-gray-600">
                      {row.dependsOn.length ? <ul className="space-y-1">{row.dependsOn.map((dependency) => <li key={dependency}><button type="button" onClick={(event) => { event.stopPropagation(); navigateDependency(dependency); }} className="text-blue-700 underline-offset-2 hover:underline">{dependency}</button></li>)}</ul> : <span aria-label="No dependencies">—</span>}
                    </td>
                    <td className="px-3 py-3"><span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-2 py-1 text-[10px] font-bold", row.warningCount > 0 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500")} aria-label={`${row.warningCount} warnings`}>{row.warningCount}</span></td>
                    <td className="whitespace-nowrap px-3 py-3"><ResourceStatus status={row.status} /></td>
                    <td className="px-3 py-3"><button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} specification for ${row.name}`} onClick={(event) => { event.stopPropagation(); setExpandedId(expanded ? null : row.id); }} className="rounded px-2 py-1 text-blue-700 hover:bg-blue-100">{expanded ? "Hide" : "Details"}</button></td>
                  </tr>
                  {expanded ? <tr className="bg-gray-50"><td colSpan={8} className="px-4 py-4"><h4 className="text-xs font-semibold text-gray-800">{row.name} specification</h4>{row.spec ? <pre data-testid={`resource-spec-${row.id}`} className="mt-2 max-h-72 overflow-auto rounded-md bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{JSON.stringify(redactSensitiveFields(row.spec), null, 2)}</pre> : <p className="mt-2 text-xs text-gray-500">No resource specification available.</p>}</td></tr> : null}
                </Fragment>
              );
            })}
            {visibleRows.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">No resources match these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

defaultRegistry.register({
  type: "resource_table",
  version: "1.0",
  schema: resourceTableSchema,
  component: ResourceTableComponent,
});
