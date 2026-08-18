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
  const [isExporting, setIsExporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const load = async (): Promise<boolean> => {
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
        return false;
      } else if (result.data.length === 0) {
        setResources([]);
        setError(null);
        setViewState("empty");
        return true;
      } else {
        setResources(result.data);
        setError(null);
        setViewState("default");
        return true;
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while loading resources.";
      setError(msg);
      setResources([]);
      setViewState("error");
      return false;
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleExport = () => {
    if (resources.length === 0 || isExporting) return;
    setIsExporting(true);
    setFeedback(null);
    try {
      const reportData = {
        reportTitle: "Provisr Cloud Resource Inventory",
        generatedAt: new Date().toISOString(),
        totalResources: resources.length,
        driftCount: driftCount(resources),
        providers: providerCounts(resources),
        resources,
      };
      const blob = new Blob([JSON.stringify(reportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `provisr-resources-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setFeedback({
        type: "success",
        message: `Resource report exported successfully (${resources.length} resources).`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to export resource report.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setFeedback(null);
    try {
      const ok = await load();
      if (ok) {
        setFeedback({
          type: "success",
          message: "State synchronization complete. Inventory is up to date.",
        });
      } else {
        setFeedback({
          type: "error",
          message: "State synchronization failed. Please check credentials and retry.",
        });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "State synchronization failed.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const counts = providerCounts(resources);
  const drift = driftCount(resources);

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Button
              aria-busy={isExporting}
              disabled={
                resources.length === 0 || isExporting || viewState === "loading"
              }
              onClick={handleExport}
              variant="secondary"
            >
              <DownloadIcon
                className={cn("size-4", isExporting && "animate-pulse")}
              />
              {isExporting ? "Exporting..." : "Export report"}
            </Button>
            <Button
              aria-busy={isSyncing}
              disabled={isSyncing || viewState === "loading"}
              onClick={handleSync}
            >
              <RotateCcwIcon
                className={cn("size-4", isSyncing && "animate-spin")}
              />
              {isSyncing ? "Syncing state..." : "Run state sync"}
            </Button>
          </>
        }
        description="Cloud resources known to Provisr through managed requests and state sync. Drift is detected against the last planned state."
        title="Resource dashboard"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          {feedback ? (
            <SectionCard>
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "size-2 rounded-full",
                      feedback.type === "success"
                        ? "bg-green-500"
                        : "bg-red-500"
                    )}
                  />
                  <span
                    className={
                      feedback.type === "success"
                        ? "text-green-700 font-medium"
                        : "text-red-900 font-medium"
                    }
                  >
                    {feedback.message}
                  </span>
                </div>
                <button
                  aria-label="Dismiss feedback"
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  onClick={() => setFeedback(null)}
                  type="button"
                >
                  ✕
                </button>
              </div>
            </SectionCard>
          ) : null}

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