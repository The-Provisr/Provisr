import { z } from "zod";
import { defaultRegistry } from "../registry";

export const networkingTopologySchema = z.object({
  vpcCidr: z.string(),
  subnets: z.array(
    z.object({
      name: z.string(),
      cidr: z.string(),
      type: z.enum(["public", "private", "isolated"]),
      zone: z.string().optional(),
    }),
  ),
  natGateway: z.boolean().optional(),
  internetGateway: z.boolean().optional(),
  securityGroups: z
    .array(
      z.object({
        name: z.string(),
        rulesCount: z.number(),
      }),
    )
    .optional(),
});

export type NetworkingTopologyData = z.infer<typeof networkingTopologySchema>;

export function NetworkingTopologyComponent({
  data,
}: {
  data: NetworkingTopologyData;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
          Networking Topology
        </span>
        <span className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800">
          VPC: {data.vpcCidr}
        </span>
      </div>

      <div className="mt-3 flex gap-2 text-xs">
        {data.internetGateway ? (
          <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">Internet Gateway (IGW)</span>
        ) : null}
        {data.natGateway ? (
          <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">NAT Gateway</span>
        ) : null}
      </div>

      <div className="mt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Subnets ({data.subnets.length})
        </span>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {data.subnets.map((sub) => (
            <div
              key={sub.name}
              className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/50 p-2.5 text-xs"
            >
              <div>
                <span className="font-medium text-gray-800">{sub.name}</span>
                <p className="font-mono text-gray-500">{sub.cidr}</p>
              </div>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  sub.type === "public"
                    ? "bg-green-100 text-green-700"
                    : sub.type === "private"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-700"
                }`}
              >
                {sub.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "networking_topology",
  version: "1.0",
  schema: networkingTopologySchema,
  component: NetworkingTopologyComponent,
});
