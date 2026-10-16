import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { defaultRegistry } from "../registry";

import { regionSelectorSchema } from "@provisr/shared-contracts";
export { regionSelectorSchema } from "@provisr/shared-contracts";

export type RegionSelectorData = z.infer<typeof regionSelectorSchema>;
export type RegionSelectionUpdate = {
  type: "region_selection";
  provider: RegionSelectorData["provider"];
  regionId: string;
};

const providerLabels: Record<RegionSelectorData["provider"], string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
};

const providerLogos: Record<RegionSelectorData["provider"], string> = {
  aws: "aws-2.svg",
  azure: "azure-2.svg",
  gcp: "google-cloud-1.svg",
};

function latencyStatus(latencyMs?: number): { color: string; label: string } | undefined {
  if (latencyMs === undefined) return undefined;
  if (latencyMs < 100) return { color: "bg-green-500", label: "Low latency" };
  if (latencyMs < 250) return { color: "bg-yellow-500", label: "Medium latency" };
  return { color: "bg-red-500", label: "High latency" };
}

export function RegionSelectorComponent({
  data,
  onUpdate,
  onConnectProvider,
}: {
  data: RegionSelectorData;
  onUpdate?: (update: RegionSelectionUpdate) => void;
  onConnectProvider?: () => void;
}) {
  const providerOptions = useMemo(
    () =>
      data.providers?.length
        ? data.providers
        : [{ provider: data.provider, selectedRegion: data.selectedRegion, availableRegions: data.availableRegions }],
    [data.availableRegions, data.provider, data.providers, data.selectedRegion],
  );
  const preferredProvider = providerOptions.find((option) => option.provider === data.provider) ?? providerOptions[0];
  const [provider, setProvider] = useState(preferredProvider?.provider ?? data.provider);
  const activeProvider = providerOptions.find((option) => option.provider === provider) ?? providerOptions[0];
  const [selectedRegion, setSelectedRegion] = useState(
    preferredProvider?.provider === data.provider
      ? data.selectedRegion
      : preferredProvider?.selectedRegion ?? "",
  );

  useEffect(() => {
    const nextProvider = providerOptions.find((option) => option.provider === data.provider) ?? providerOptions[0];
    setProvider(nextProvider?.provider ?? data.provider);
    setSelectedRegion(
      nextProvider?.provider === data.provider
        ? data.selectedRegion
        : nextProvider?.selectedRegion ?? "",
    );
  }, [data.provider, data.selectedRegion, providerOptions]);

  if (data.loading) {
    return (
      <section aria-label="Loading regions" aria-busy="true" className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
        <div className="h-3 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </section>
    );
  }

  const activeProviderId = activeProvider?.provider ?? data.provider;
  const regions = activeProvider?.availableRegions ?? [];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs" aria-label="Target region selection">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Target Region Selection</span>
        {providerOptions.length > 1 ? (
          <div className="flex gap-1" aria-label="Cloud provider">
            {providerOptions.map((option) => (
              <button
                key={option.provider}
                type="button"
                aria-pressed={provider === option.provider}
                onClick={() => {
                  setProvider(option.provider);
                  setSelectedRegion(option.selectedRegion ?? "");
                }}
                className={`rounded px-2 py-1 text-xs font-semibold ${provider === option.provider ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}`}
              >
                {providerLabels[option.provider]}
              </button>
            ))}
          </div>
        ) : (
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold uppercase text-blue-700">
            {providerLabels[activeProviderId]}
          </span>
        )}
      </div>

      {data.reasoning ? <p className="mt-2 text-xs text-gray-600">{data.reasoning}</p> : null}
      {regions.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-5 text-center">
          <p className="text-sm font-medium text-gray-700">No connected provider regions</p>
          <p className="mt-1 text-xs text-gray-500">Connect a provider to choose a deployment region.</p>
          {onConnectProvider ? (
            <button type="button" onClick={onConnectProvider} className="mt-3 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              Connect provider
            </button>
          ) : (
            <a href="/onboarding" className="mt-3 inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              Connect provider
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 text-xs text-gray-500">Selected region: <span className="font-semibold text-gray-800">{selectedRegion || "Choose a region"}</span></div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Regions">
            {regions.map((region) => {
              const unavailable = !region.available;
              const disabled = unavailable || region.restrictedByPolicy;
              const latency = latencyStatus(region.latencyMs);
              return (
                <button
                  key={region.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedRegion === region.id}
                  aria-disabled={disabled}
                  aria-label={`${region.name}, ${region.id}${unavailable ? ", not available" : ""}${region.restrictedByPolicy ? ", restricted by policy" : ""}`}
                  title={region.restrictedByPolicy ? "Restricted by policy" : undefined}
                  disabled={disabled}
                  onClick={() => {
                    setSelectedRegion(region.id);
                    onUpdate?.({ type: "region_selection", provider: activeProviderId, regionId: region.id });
                  }}
                  className={`relative flex min-h-16 items-center justify-between rounded-lg border p-2.5 text-left text-xs transition-colors disabled:cursor-not-allowed ${
                    disabled ? "border-gray-200 bg-gray-100 text-gray-400" : selectedRegion === region.id ? "border-blue-500 bg-blue-50/40" : "border-gray-200 bg-white hover:border-blue-300"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-50">
                      <img src={`/assets/${providerLogos[activeProviderId]}`} alt="" className="h-5 w-5 object-contain" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-gray-800">{region.name}</span>
                      <span className="block font-mono text-[11px] text-gray-500">{region.id}</span>
                    </span>
                  </span>
                  <span className="ml-2 flex shrink-0 flex-col items-end gap-1">
                    {latency ? <span className="flex items-center gap-1 text-[10px] text-gray-600"><span className={`h-2 w-2 rounded-full ${latency.color}`} aria-hidden="true" /><span>{region.latencyMs}ms</span><span className="sr-only">{latency.label}</span></span> : null}
                    {region.restrictedByPolicy ? <span className="text-[10px] font-semibold text-amber-700" aria-hidden="true">🔒</span> : null}
                    {region.complianceCompliant ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-semibold text-green-700">Compliant</span> : null}
                  </span>
                  {unavailable ? <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-gray-100/80 text-[10px] font-semibold text-gray-600">Not available</span> : null}
                  {region.restrictedByPolicy ? <span className="sr-only">Restricted by policy</span> : null}
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

defaultRegistry.register({
  type: "region_selector",
  version: "1.0",
  schema: regionSelectorSchema,
  component: RegionSelectorComponent,
});
