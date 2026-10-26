"use client";

import { useId } from "react";
import { z } from "zod";
import { securityWarningSchema } from "@provisr/shared-contracts";
import { AlertTriangleIcon, CheckIcon } from "@/components/ui/icons";
import { defaultRegistry } from "../registry";

export { securityWarningSchema } from "@provisr/shared-contracts";
export type SecurityWarningData = z.infer<typeof securityWarningSchema>;

const groups = [
  { severity: "critical", label: "Critical", badge: "bg-red-100 text-red-800 border-red-200" },
  { severity: "high", label: "High", badge: "bg-red-100 text-red-800 border-red-200" },
  { severity: "medium", label: "Medium", badge: "bg-amber-100 text-amber-800 border-amber-200" },
  { severity: "low", label: "Low", badge: "bg-gray-100 text-gray-700 border-gray-200" },
] as const;

export function SecurityWarningComponent({ data, state = "default" }: {
  data?: unknown;
  state?: "default" | "loading" | "error";
}) {
  const headingId = useId();
  if (state === "loading") {
    return <section role="status" aria-label="Loading security warnings"
      className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm text-gray-700">Checking security findings…</p>
      <div aria-hidden="true" className="mt-3 h-16 animate-pulse rounded bg-gray-100" />
    </section>;
  }
  const parsed = securityWarningSchema.safeParse(data);
  if (state === "error" || !parsed.success) {
    return <section role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <p className="font-semibold text-gray-900">Security findings unavailable</p>
      <p className="mt-1 text-sm text-gray-700">The security review could not be displayed. Retry the review before confirming.</p>
    </section>;
  }
  const findings = "findings" in parsed.data ? parsed.data.findings : [parsed.data];
  if (findings.length === 0) {
    return <section role="status" aria-label="Security review clear"
      className="rounded-xl border border-green-200 bg-green-50 p-5">
      <div className="flex items-center gap-2 font-semibold text-gray-900">
        <CheckIcon aria-hidden="true" className="size-4" />
        <h3>No security warnings</h3>
      </div>
      <p className="mt-1 text-sm text-gray-700">No security findings were reported for this review.</p>
    </section>;
  }
  const urgent = findings.some(finding => finding.severity === "critical" || finding.severity === "high");
  return <section role={urgent ? "alert" : "region"} aria-labelledby={headingId}
    className={`rounded-xl border bg-white p-5 shadow-xs ${urgent ? "border-red-200" : "border-amber-200"}`}>
    <div className="flex items-center gap-2 text-gray-900">
      <AlertTriangleIcon aria-hidden="true" className="size-5 shrink-0" />
      <h3 id={headingId} className="font-semibold">Security warnings ({findings.length})</h3>
    </div>
    <p className="mt-1 text-xs text-gray-600">Review these findings and suggested fixes before confirmation.</p>
    <div className="mt-4 space-y-4">
      {groups.map(group => {
        const matching = findings.filter(finding => finding.severity === group.severity);
        if (!matching.length) return null;
        return <section key={group.severity} aria-label={`${group.label} severity findings`}>
          <h4 className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${group.badge}`}>
            {group.label} ({matching.length})
          </h4>
          <ul className="mt-2 space-y-3">
            {matching.map((finding, index) => {
              const fixes = [...(finding.suggestedFix ? [finding.suggestedFix] : []), ...(finding.mitigationSteps ?? [])];
              return <li key={`${finding.title}:${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="break-words text-sm font-semibold text-gray-900">{finding.title}</p>
                {finding.affectedResource && <p className="mt-1 break-all font-mono text-xs text-gray-600">{finding.affectedResource}</p>}
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{finding.description}</p>
                {fixes.length > 0 && <div className="mt-2 text-sm text-gray-700">
                  <p className="font-semibold">Suggested fixes</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {fixes.map((fix, fixIndex) => <li className="whitespace-pre-wrap break-words" key={fixIndex}>{fix}</li>)}
                  </ul>
                </div>}
              </li>;
            })}
          </ul>
        </section>;
      })}
    </div>
  </section>;
}

defaultRegistry.register({ type: "security_warning", version: "1.0",
  schema: securityWarningSchema, component: SecurityWarningComponent });
