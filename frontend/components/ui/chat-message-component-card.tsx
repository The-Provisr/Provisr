import type { ComponentPayload } from "@provisr/shared-contracts";
import type { ReactNode } from "react";

type ComponentCardProps = {
  payload: ComponentPayload;
  /** FE-C01 registry renderer. Absent until the registry merges. */
  renderComponent?: (payload: ComponentPayload) => ReactNode;
};

export function ComponentCard({
  payload,
  renderComponent,
}: ComponentCardProps) {
  if (renderComponent) {
    return <>{renderComponent(payload)}</>;
  }

  return (
    <div className="mt-2 max-w-[480px] rounded-lg border border-gray-100 bg-white p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Component
      </div>
      <div className="mt-1 text-sm font-medium text-white">{payload.type}</div>
      <div className="mt-1 text-xs text-gray-500">version {payload.version}</div>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">
        Rendered once the component registry (FE-C01) is available.
      </p>
    </div>
  );
}
