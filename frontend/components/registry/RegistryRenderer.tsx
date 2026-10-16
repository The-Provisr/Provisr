"use client";

import type { ComponentPayload } from "@provisr/shared-contracts";
import { useMemo, type ComponentType } from "react";
import { useRegistry } from "./useRegistry";
import { resolvePayload } from "./dispatch";
import { UnknownComponentFallback } from "./fallbacks/UnknownComponentFallback";
import { InvalidPayloadFallback } from "./fallbacks/InvalidPayloadFallback";
import type { RegionSelectionUpdate } from "./components/region_selector";

export function RegistryRenderer({
  payload,
  onRegionSelection,
  onConnectProvider,
}: {
  payload: ComponentPayload | unknown;
  onRegionSelection?: (update: RegionSelectionUpdate) => void;
  onConnectProvider?: () => void;
}) {
  const registry = useRegistry();
  const result = useMemo(
    () => resolvePayload(registry, payload),
    [registry, payload],
  );

  switch (result.kind) {
    case "unknown":
      return <UnknownComponentFallback type={result.type} />;
    case "invalid":
      return (
        <InvalidPayloadFallback type={result.type} reason={result.reason} issues={result.issues} />
      );
    case "render": {
      const { Component, data } = result;
      if (result.type === "region_selector") {
        const RegionComponent = Component as ComponentType<{
          data: typeof data;
          onUpdate?: (update: RegionSelectionUpdate) => void;
          onConnectProvider?: () => void;
        }>;
        return (
          <RegionComponent
            data={data}
            onUpdate={onRegionSelection}
            onConnectProvider={onConnectProvider}
          />
        );
      }
      return <Component data={data} />;
    }
  }
}
