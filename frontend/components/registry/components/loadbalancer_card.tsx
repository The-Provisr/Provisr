import { z } from "zod";
import { defaultRegistry } from "../registry";

export const loadbalancerCardSchema = z.object({
  name: z.string(),
  type: z.enum(["application", "network", "gateway"]).default("application"),
  scheme: z.enum(["internet-facing", "internal"]).default("internet-facing"),
  listeners: z.array(
    z.object({
      port: z.number(),
      protocol: z.string(),
      sslCertificate: z.boolean().optional(),
    }),
  ),
  targetGroups: z
    .array(
      z.object({
        name: z.string(),
        port: z.number(),
        healthCheckStatus: z.string().optional(),
      }),
    )
    .optional(),
});

export type LoadbalancerCardData = z.infer<typeof loadbalancerCardSchema>;

export function LoadbalancerCardComponent({
  data,
}: {
  data: LoadbalancerCardData;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
          Load Balancer ({data.type.toUpperCase()})
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            data.scheme === "internet-facing"
              ? "bg-amber-50 text-amber-700"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          {data.scheme}
        </span>
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">{data.name}</h3>

      <div className="mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Listeners ({data.listeners.length})
        </span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {data.listeners.map((l, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1 text-xs"
            >
              <span className="font-mono font-medium text-gray-800">
                {l.protocol}:{l.port}
              </span>
              {l.sslCertificate ? (
                <span className="rounded bg-green-100 px-1 py-0.2 text-[9px] font-bold text-green-700">
                  TLS/SSL
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "loadbalancer_card",
  version: "1.0",
  schema: loadbalancerCardSchema,
  component: LoadbalancerCardComponent,
});
