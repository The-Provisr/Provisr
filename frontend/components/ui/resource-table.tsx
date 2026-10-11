"use client";

import { useMemo, useState } from "react";
import { CloudProviderLogo } from "@/components/ui/cloud-provider-logo";
import {
  DatabaseIcon,
  ExternalLinkIcon,
  HardDriveIcon,
  NetworkIcon,
  SearchIcon,
  ServerStackIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/time";
import {
  providerMeta,
  statusLabel,
  type ProviderId,
  type ResourceItem,
  type ResourceMetadata,
  type ResourceSortKey,
} from "@/lib/resources/types";

const statusDot: Record<ResourceItem["status"], string> = {
  running: "bg-green-500",
  stopped: "bg-slate-900",
  terminated: "bg-red-500",
  unknown: "bg-amber-500",
};

function typeIcon(type: string) {
  const className = "size-4 shrink-0 text-gray-400";
  if (type.includes("rds") || type.includes("database") || type.includes("postgres")) {
    return <DatabaseIcon className={className} />;
  }
  if (type.includes("lb") || type.includes("load_balancer") || type.includes("vnet") || type.includes("network")) {
    return <NetworkIcon className={className} />;
  }
  if (type.includes("storage") || type.includes("bucket") || type.includes("volume")) {
    return <HardDriveIcon className={className} />;
  }
  return <ServerStackIcon className={className} />;
}

export function diffLines(
  left: ResourceMetadata,
  right: ResourceMetadata,
): {
  left: string[];
  right: string[];
} {
  const leftLines = JSON.stringify(left ?? {}, null, 2).split("\n");
  const rightLines = JSON.stringify(right ?? {}, null, 2).split("\n");

  const m = leftLines.length;
  const n = rightLines.length;

  // Build DP table for Longest Common Subsequence (LCS)
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    const row = dp[i]!;
    const prevRow = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  // Backtrack to find aligned matching lines
  const leftMatched = new Array<boolean>(m).fill(false);
  const rightMatched = new Array<boolean>(n).fill(false);

  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (leftLines[i - 1] === rightLines[j - 1]) {
      leftMatched[i - 1] = true;
      rightMatched[j - 1] = true;
      i--;
      j--;
    } else {
      const up = dp[i - 1]?.[j] ?? 0;
      const leftVal = dp[i]?.[j - 1] ?? 0;
      if (up >= leftVal) {
        i--;
      } else {
        j--;
      }
    }
  }

  return {
    left: leftLines.map((_, idx) => (leftMatched[idx] ? "" : "changed")),
    right: rightLines.map((_, idx) => (rightMatched[idx] ? "" : "changed")),
  };
}

type ResourceTableRowProps = {
  onToggle: () => void;
  expanded: boolean;
  resource: ResourceItem;
};

function ResourceTableRow({ onToggle, expanded, resource }: ResourceTableRowProps) {
  const hasConflict = resource.drift && resource.expected && resource.actual;
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-3 py-3">
          <button
            aria-expanded={expanded}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={onToggle}
            type="button"
          >
            <span aria-hidden="true">{expanded ? "–" : "+"}</span>
            <span className="sr-only">{expanded ? "Collapse" : "Expand"} resource</span>
          </button>
        </td>
        <td className="px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {typeIcon(resource.type)}
            <div className="min-w-0">
              <div className="truncate font-medium text-gray-900">
                {resource.name}
              </div>
              <div className="truncate font-mono text-[11px] text-gray-400">
                {resource.type}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <CloudProviderLogo provider={resource.provider} size="sm" />
            <span className="text-sm text-gray-700">{providerMeta[resource.provider].label}</span>
          </div>
        </td>
        <td className="px-3 py-3 text-sm text-gray-700">{resource.region}</td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-2 rounded-full", statusDot[resource.status])} />
            <span className="text-sm text-gray-700">{statusLabel[resource.status]}</span>
          </div>
        </td>
        <td className="px-3 py-3">
          {resource.drift ? (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-900">
              Drift
            </span>
          ) : (
            <span className="rounded-full border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
              In sync
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-sm text-gray-500">
          {formatRelativeTime(resource.lastSynced)}
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={7} className="border-b border-gray-100 px-4 py-4">
            <div className="grid gap-4 md:grid-cols-2 md:border-l md:pl-8">
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Metadata
                  </div>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-gray-700">
                    {JSON.stringify(resource.metadata, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Tags
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(resource.tags).map(([key, value]) => (
                      <span
                        className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                        key={key}
                      >
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Ownership
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    {resource.ownerRunId ? (
                      <a
                        className="inline-flex items-center gap-1 font-medium text-blue-700 hover:text-blue-800"
                        href="/requests"
                      >
                        {resource.ownerRunId}
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    ) : (
                      "No linked provisioning run"
                    )}
                    <div className="mt-1 text-xs text-gray-500">
                      Last synced {formatRelativeTime(resource.lastSynced)}
                    </div>
                  </div>
                </div>
              </div>
              {hasConflict ? (
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Drift comparison
                    </div>
                  </div>
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium text-red-900">Planned state</div>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-gray-700">
                          {diffLines(resource.expected!, resource.actual!).left
                            .map((flag, index) => (
                              <span
                                className={flag ? "text-red-900 line-through" : undefined}
                                key={index}
                              >
                                {JSON.stringify(resource.expected!, null, 2).split("\n")[index]}
                                {"\n"}
                              </span>
                            ))}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-green-700">Actual state</div>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-gray-700">
                          {diffLines(resource.expected!, resource.actual!).right
                            .map((flag, index) => (
                              <span
                                className={flag ? "text-green-700" : undefined}
                                key={index}
                              >
                                {JSON.stringify(resource.actual!, null, 2).split("\n")[index]}
                                {"\n"}
                              </span>
                            ))}
                        </pre>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Remediation is applied through the provisioning chat; resources are never
                    edited directly.
                  </p>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

type ResourceTableProps = {
  resources: ResourceItem[];
};

type SortState = {
  dir: "asc" | "desc";
  key: ResourceSortKey;
} | null;

export function ResourceTable({ resources }: ResourceTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<"all" | ProviderId>("all");
  const [driftFilter, setDriftFilter] = useState<"all" | "drift" | "clean">("all");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = resources.filter((resource) => {
      if (query && !`${resource.name} ${resource.type} ${resource.region}`.toLowerCase().includes(query)) {
        return false;
      }
      if (providerFilter !== "all" && resource.provider !== providerFilter) {
        return false;
      }
      if (driftFilter === "drift" && !resource.drift) {
        return false;
      }
      if (driftFilter === "clean" && resource.drift) {
        return false;
      }
      return true;
    });
    if (!sort) {
      return filtered;
    }
    const compare = (a: ResourceItem, b: ResourceItem) => {
      const left = a[sort.key];
      const right = b[sort.key];
      return String(left).localeCompare(String(right));
    };
    return [...filtered].sort((a, b) => (sort.dir === "asc" ? compare(a, b) : -compare(a, b)));
  }, [driftFilter, providerFilter, resources, search, sort]);

  const toggleSort = (key: ResourceSortKey) => {
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const hasFilters = search !== "" || providerFilter !== "all" || driftFilter !== "all";
  const sortable = (key: ResourceSortKey, label: string) => (
    <th
      aria-sort={sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className="px-3 py-3 font-semibold"
      key={key}
    >
      <button
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-600"
        onClick={() => toggleSort(key)}
        type="button"
      >
        {label}
        <span aria-hidden="true">{sort?.key === key ? (sort.dir === "asc" ? "↑" : "↓") : null}</span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-0 flex-1 items-center">
          <SearchIcon className="pointer-events-none absolute left-3 size-4 text-gray-400" />
          <input
            aria-label="Search resources"
            className="w-full rounded-lg border border-gray-100 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search resources…"
            value={search}
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">Provider</span>
          <select
            className="rounded-lg border border-gray-100 bg-white px-2 py-2 text-sm text-gray-900"
            onChange={(event) => setProviderFilter(event.target.value as "all" | ProviderId)}
            value={providerFilter}
          >
            <option value="all">All providers</option>
            <option value="aws">AWS</option>
            <option value="azure">Azure</option>
            <option value="gcp">GCP</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">Drift status</span>
          <select
            className="rounded-lg border border-gray-100 bg-white px-2 py-2 text-sm text-gray-900"
            onChange={(event) => setDriftFilter(event.target.value as "all" | "drift" | "clean")}
            value={driftFilter}
          >
            <option value="all">All drift statuses</option>
            <option value="drift">Drift</option>
            <option value="clean">In sync</option>
          </select>
        </label>
        {hasFilters ? (
          <button
            className="text-sm font-medium text-blue-700 hover:text-blue-800"
            onClick={() => {
              setSearch("");
              setProviderFilter("all");
              setDriftFilter("all");
            }}
            type="button"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-10 text-center">
          <div className="text-sm font-medium text-gray-900">No resources match your filters</div>
          <div className="mt-1 text-xs text-gray-500">
            Try clearing the search or switching the provider filter.
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400">
                <th className="px-3 py-3" />
                {sortable("name", "Resource")}
                <th className="px-3 py-3 font-semibold">Provider</th>
                <th className="px-3 py-3 font-semibold">Region</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Drift</th>
                {sortable("lastSynced", "Last synced")}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((resource) => (
                <ResourceTableRow
                  expanded={expandedId === resource.id}
                  key={resource.id}
                  onToggle={() =>
                    setExpandedId((current) => (current === resource.id ? null : resource.id))
                  }
                  resource={resource}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}