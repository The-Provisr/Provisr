import { z } from "zod";
import { defaultRegistry } from "../registry";

export const resourceTableSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      provider: z.string(),
      status: z.string(),
      monthlyCostUsd: z.number().optional(),
    }),
  ),
});

export type ResourceTableData = z.infer<typeof resourceTableSchema>;

export function ResourceTableComponent({ data }: { data: ResourceTableData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between pb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {data.title || `Resources (${data.rows.length})`}
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-100 font-semibold uppercase tracking-wider text-gray-400">
              <th className="pb-2">Name</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Provider</th>
              <th className="pb-2">Status</th>
              <th className="pb-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td className="py-2.5 font-medium text-gray-800">{row.name}</td>
                <td className="py-2.5 font-mono text-gray-500">{row.type}</td>
                <td className="py-2.5 uppercase text-gray-600">{row.provider}</td>
                <td className="py-2.5">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                    {row.status}
                  </span>
                </td>
                <td className="py-2.5 text-right font-medium text-gray-900">
                  {row.monthlyCostUsd !== undefined ? `$${row.monthlyCostUsd}/mo` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "resource_table",
  version: "1.0",
  schema: resourceTableSchema,
  component: ResourceTableComponent,
});
