import { z } from "zod";
import { defaultRegistry } from "../registry";

export const terraformReviewSchema = z.object({
  moduleName: z.string(),
  provider: z.string(),
  version: z.string().optional(),
  codeSnippet: z.string(),
  summary: z.string().optional(),
  files: z
    .array(
      z.object({
        filename: z.string(),
        linesCount: z.number(),
      }),
    )
    .optional(),
});

export type TerraformReviewData = z.infer<typeof terraformReviewSchema>;

export function TerraformReviewComponent({ data }: { data: TerraformReviewData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">
            Generated IaC Module
          </span>
          <h3 className="text-base font-semibold text-gray-900">{data.moduleName}</h3>
        </div>
        <span className="rounded bg-purple-50 px-2 py-0.5 font-mono text-xs font-semibold text-purple-700 uppercase">
          {data.provider}
        </span>
      </div>

      {data.summary ? <p className="mt-1 text-xs text-gray-600">{data.summary}</p> : null}

      <div className="mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Terraform HCL Code (Read-Only)
        </span>
        <pre className="mt-1.5 max-h-60 overflow-x-auto rounded-lg bg-gray-900 p-3 font-mono text-xs text-gray-100 leading-relaxed">
          <code>{data.codeSnippet}</code>
        </pre>
      </div>

      {data.files && data.files.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {data.files.map((f) => (
            <span key={f.filename} className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">
              {f.filename} ({f.linesCount} lines)
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "terraform_review",
  version: "1.0",
  schema: terraformReviewSchema,
  component: TerraformReviewComponent,
});
