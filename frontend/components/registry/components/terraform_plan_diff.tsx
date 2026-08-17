import { z } from "zod";
import { defaultRegistry } from "../registry";

export const terraformPlanDiffSchema = z.object({
  addCount: z.number(),
  changeCount: z.number(),
  destroyCount: z.number(),
  changes: z.array(
    z.object({
      resourceType: z.string(),
      resourceName: z.string(),
      action: z.enum(["create", "update", "delete", "no-op"]),
      details: z.string().optional(),
    }),
  ),
});

export type TerraformPlanDiffData = z.infer<typeof terraformPlanDiffSchema>;

export function TerraformPlanDiffComponent({
  data,
}: {
  data: TerraformPlanDiffData;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Terraform Execution Plan
        </span>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="rounded bg-green-100 px-2 py-0.5 text-green-800">
            +{data.addCount} to add
          </span>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">
            ~{data.changeCount} to change
          </span>
          <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">
            -{data.destroyCount} to destroy
          </span>
        </div>
      </div>

      <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
        {data.changes.map((c, i) => (
          <div key={i} className="flex items-start justify-between p-2.5 text-xs">
            <div>
              <span className="font-mono font-medium text-gray-900">{c.resourceName}</span>
              <p className="font-mono text-gray-400">{c.resourceType}</p>
              {c.details ? <p className="mt-1 text-gray-500">{c.details}</p> : null}
            </div>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                c.action === "create"
                  ? "bg-green-100 text-green-700"
                  : c.action === "update"
                    ? "bg-amber-100 text-amber-700"
                    : c.action === "delete"
                      ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-600"
              }`}
            >
              {c.action}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "terraform_plan_diff",
  version: "1.0",
  schema: terraformPlanDiffSchema,
  component: TerraformPlanDiffComponent,
});
