"use client";

import type { ComponentPayload } from "@provisr/shared-contracts";
import { useRegistry } from "./useRegistry";
import { resolvePayload } from "./dispatch";
import { UnknownComponentFallback } from "./fallbacks/UnknownComponentFallback";
import { InvalidPayloadFallback } from "./fallbacks/InvalidPayloadFallback";
import type { ResourceNavigationRequest } from "./components/resource_table";

export function RegistryRenderer({
  payload,
  onNavigateResource,
}: {
  payload: ComponentPayload | unknown;
  onNavigateResource?: (request: ResourceNavigationRequest) => void;
}) {
  const registry = useRegistry();
  const result = resolvePayload(registry, payload);

  switch (result.kind) {
    case "unknown":
      return <UnknownComponentFallback type={result.type} />;
    case "invalid":
      return (
        <InvalidPayloadFallback type={result.type} reason={result.reason} issues={result.issues} />
      );
    case "render": {
      const { Component, data } = result;
      if (result.type === "resource_table") {
        const ResourceComponent = Component as import("react").ComponentType<{
          data: typeof data;
          onNavigateResource?: (request: ResourceNavigationRequest) => void;
        }>;
        return <ResourceComponent data={data} onNavigateResource={onNavigateResource} />;
      }
      return <Component data={data} />;
    }
  }
}
