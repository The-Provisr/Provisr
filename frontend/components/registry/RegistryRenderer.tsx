"use client";

import type { ComponentPayload } from "@provisr/shared-contracts";
import { useRegistry } from "./useRegistry";
import { resolvePayload } from "./dispatch";
import { UnknownComponentFallback } from "./fallbacks/UnknownComponentFallback";
import { InvalidPayloadFallback } from "./fallbacks/InvalidPayloadFallback";

export function RegistryRenderer({ payload }: { payload: ComponentPayload }) {
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
      return <Component data={data} />;
    }
  }
}
