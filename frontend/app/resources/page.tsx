"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DownloadIcon,
  LayoutGridIcon,
  RotateCcwIcon,
  ServerStackIcon,
} from "@/components/ui/icons";
import {
  AppShell,
  EmptyAction,
  PageBody,
  PageHeader,
  SectionCard,
  StatCard,
} from "@/components/ui/provisr-app";
import { ResourceDonut } from "@/components/ui/resource-donut";
import { ResourceDriftBanner } from "@/components/ui/resource-drift-banner";
import { ResourceTable } from "@/components/ui/resource-table";
import { cn } from "@/lib/cn";
import {
  driftCount,
  fetchResources,
  providerCounts,
} from "@/lib/resources/mock-data";
import {
  providerMeta,
  type ResourceItem,
  type ResourceViewState,
} from "@/lib/resources/types";

export default function ResourcesPage() {
  const [viewState, setViewState] = useState<ResourceViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);

  const load = async () => {
    setViewState("loading");
    setError(null);

    const scenario =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("scenario") ||
          new URLSearchParams(window.location.search).get("state")
        : null;

    try {
      const result = await fetchResources(scenario);
      if (!result.success) {
        setError(result.error);
        setResources([]);
        setViewState("error");
      } else if (result.data.length === 0) {
        setResources([]);
        setError(null);
        setViewState("empty");
      } else {
        setResources(result.data);
        setError(null);
        setViewState("default");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while loading resources."
      );
      setResources([]);
      setViewState("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = providerCounts(resources);
  const drift = driftCount(resources);

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Button variant="secondary">
              <DownloadIcon className="size-4" />
              Export report
            </Button>
            <Button onClick={load}>
              <RotateCcwIcon className="size-4" />
              Run state sync
            </Button>
          </>
        }
        description="Cloud resources known to Provisr through managed requests and state sync. Drift is detected against the last planned state."
        title="Resource dashboard"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          {error || viewState === "error" ? (
            <SectionCard>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-red-900">
                    Could not load resources
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {error ?? "An unknown error occurred."}
                  </div>
                </div>
                <Button onClick={load} variant="secondary">
                  Retry
                </Button>
              </div>
            </SectionCard>
          ) : null}

          {viewState === "loading" ? (
            <div aria-busy="true" aria-label="Loading resource dashboard">
              <SectionCard className="animate-pulse">
                <div className="h-20 rounded-lg bg-gray-100" />
              </SectionCard>
              <SectionCard className="animate-pulse">
                <div className="h-64 rounded-lg bg-gray-100" />
              </SectionCard>
            </div>
          ) : null}

          {viewState === "default" ? (
            <>
              <SectionCard>
                <div className="flex flex-wrap items-end gap-8">
                  <StatCard
                    detail={`across ${counts.length} provider${counts.length === 1 ? "" : "s"}`}
                    label="Total resources"
                    tone="neutral"
                    value={String(resources.length)}
                  />
                  <div className="flex flex-wrap gap-8">
                    {counts.map(({ count, provider }) => (
                      <ResourceDonut
                        color={providerMeta[provider].color}
                        key={provider}
                        label={providerMeta[provider].label}
                        value={count}
                      />
                    ))}
                  </div>
                </div>
              </SectionCard>

              <ResourceDriftBanner
                driftCount={drift}
                onViewDriftReport={() => {
                  document
                    .getElementById("inventory")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              />

              <div id="inventory">
                <SectionCard
                  eyebrow="Resource inventory"
                  title="Search, filter, and sort the resources Provisr manages."
                >
                  <ResourceTable resources={resources} />
                </SectionCard>
              </div>
            </>
          ) : null}

          {viewState === "empty" ? (
            <SectionCard>
              <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                <div
                  className={cn(
                    "flex size-12 items-center justify-center rounded-full bg-gray-100"
                  )}
                >
                  <LayoutGridIcon className="size-6 text-gray-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    No resources yet
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Resources appear here after a provisioning request completes.
                  </div>
                </div>
                <EmptyAction href="/chat">
                  <ServerStackIcon className="size-4" />
                  Provision through chat
                </EmptyAction>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </PageBody>
    </AppShell>
  );
}