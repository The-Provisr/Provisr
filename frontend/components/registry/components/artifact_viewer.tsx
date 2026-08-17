import { z } from "zod";
import { defaultRegistry } from "../registry";

export const artifactViewerSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["manifest", "terraform", "diagram", "cost_report", "policy_report"]),
  url: z.string().optional(),
  content: z.string().optional(),
  sizeBytes: z.number().optional(),
});

export type ArtifactViewerData = z.infer<typeof artifactViewerSchema>;

export function ArtifactViewerComponent({ data }: { data: ArtifactViewerData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600">
          Generated Artifact
        </span>
        <span className="rounded bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 uppercase">
          {data.type}
        </span>
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">{data.title}</h3>

      {data.sizeBytes ? (
        <span className="mt-1 inline-block text-xs text-gray-400 font-mono">
          {(data.sizeBytes / 1024).toFixed(1)} KB
        </span>
      ) : null}

      {data.content ? (
        <pre className="mt-3 max-h-48 overflow-x-auto rounded-lg bg-gray-900 p-3 font-mono text-xs text-gray-100">
          <code>{data.content}</code>
        </pre>
      ) : null}

      {data.url ? (
        <div className="mt-3">
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            View / Download Artifact ↗
          </a>
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "artifact_viewer",
  version: "1.0",
  schema: artifactViewerSchema,
  component: ArtifactViewerComponent,
});
