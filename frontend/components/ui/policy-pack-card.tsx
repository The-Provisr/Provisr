"use client";

import { ChevronRightIcon, RuleIcon, ShieldCheckIcon } from "@/components/ui/icons";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/cn";
import type { PolicyPack } from "@/lib/policy/types";

type PolicyPackCardProps = {
  pack: PolicyPack;
  selected?: boolean;
  onEnabledChange?: (packId: string, enabled: boolean) => void;
  onSelect?: (packId: string) => void;
};

export function PolicyPackCard({ pack, selected = false, onEnabledChange, onSelect }: PolicyPackCardProps) {
  return (
    <div
      aria-selected={selected}
      className={cn(
        "flex cursor-pointer flex-col gap-4 rounded-xl border p-5 transition-colors",
        selected ? "border-blue-100 bg-blue-50" : "border-gray-100 bg-white hover:border-gray-100 hover:bg-gray-50",
      )}
      data-testid="policy-pack-card"
      onClick={() => onSelect?.(pack.id)}
      role="option"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-gray-100 bg-white">
            <ShieldCheckIcon className="size-5 text-blue-700" />
          </div>
          <div>
            <h3 className={cn("text-sm font-semibold", selected ? "text-gray-900" : "text-gray-900")}>
              {pack.name}
            </h3>
            <span className="font-mono text-xs text-gray-500">{pack.version}</span>
          </div>
        </div>
        <Toggle
          checked={pack.enabled}
          label={`Toggle pack ${pack.name}`}
          onChange={(checked) => onEnabledChange?.(pack.id, checked)}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
      <p className="flex-1 text-sm text-gray-700">{pack.description}</p>
      <div className="flex items-center justify-between border-t border-gray-100 pt-4">
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-900">
          <RuleIcon className="size-4 text-gray-500" />
          <span className="font-semibold">{pack.ruleCount}</span> Rules
        </span>
        <button
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(pack.id);
          }}
          type="button"
        >
          Configure <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}