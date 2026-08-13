import { cn } from "@/lib/cn";
import type { PolicySeverity } from "@/lib/policy/types";

const severityMeta: Record<PolicySeverity, { label: string; className: string }> = {
  deny: {
    label: "Deny",
    className: "border-red-200 bg-red-50 text-red-900",
  },
  warn: {
    label: "Warn",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  approval: {
    label: "Approval Required",
    className: "border-blue-100 bg-blue-50 text-blue-700",
  },
};

export function PolicySeverityBadge({ severity }: { severity: PolicySeverity }) {
  const meta = severityMeta[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        meta.className,
      )}
    >
      <span className="w-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}