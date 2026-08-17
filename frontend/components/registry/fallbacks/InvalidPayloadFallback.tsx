import { SectionCard } from "@/components/ui/provisr-app";
import type { PayloadIssue } from "../dispatch";

export function InvalidPayloadFallback({
  type,
  reason,
  issues,
}: {
  type: string;
  reason: "schema" | "version";
  issues: PayloadIssue[];
}) {
  return (
    <SectionCard
      eyebrow={reason === "version" ? "Version mismatch" : "Invalid payload"}
      className="border-amber-200 bg-amber-50"
    >
      <p className="text-sm text-amber-800">
        Component <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">{type}</code> could
        not be rendered.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-amber-700">
        {issues.map((issue) => (
          <li key={issue.field}>
            <span className="font-mono">{issue.field}</span>: {issue.message}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
