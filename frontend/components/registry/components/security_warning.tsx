import { z } from "zod";
import { defaultRegistry } from "../registry";

export const securityWarningSchema = z.object({
  title: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  description: z.string(),
  affectedResource: z.string().optional(),
  mitigationSteps: z.array(z.string()).optional(),
});

export type SecurityWarningData = z.infer<typeof securityWarningSchema>;

export function SecurityWarningComponent({ data }: { data: SecurityWarningData }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-800">
          Security Alert • {data.severity.toUpperCase()}
        </span>
        {data.affectedResource ? (
          <span className="font-mono text-xs text-gray-600">({data.affectedResource})</span>
        ) : null}
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">{data.title}</h3>
      <p className="mt-1 text-xs text-gray-700 leading-relaxed">{data.description}</p>

      {data.mitigationSteps && data.mitigationSteps.length > 0 ? (
        <div className="mt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-700">
            Recommended Mitigations
          </span>
          <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-gray-700">
            {data.mitigationSteps.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "security_warning",
  version: "1.0",
  schema: securityWarningSchema,
  component: SecurityWarningComponent,
});
