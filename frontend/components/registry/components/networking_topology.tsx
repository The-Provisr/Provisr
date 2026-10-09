import { z } from "zod";
import { AlertTriangleIcon } from "@/components/ui/icons";
import { defaultRegistry } from "../registry";

export const PUBLIC_CIDRS = ["0.0.0.0/0", "::/0"] as const;

export const firewallRuleSchema = z.object({
  direction: z.enum(["ingress", "egress"]),
  protocol: z.string(),
  portRange: z.string(),
  source: z.string().optional(),
  destination: z.string().optional(),
});

export type FirewallRule = z.infer<typeof firewallRuleSchema>;

export const networkingTopologySchema = z.object({
  vpcName: z.string().optional(),
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
        rulesCount: z.coerce.number().optional(),
        rules: z.array(firewallRuleSchema).optional(),
      }),
    )
    .optional(),
});

export type NetworkingTopologyData = z.infer<typeof networkingTopologySchema>;

export type NetworkingTopologyState = "loading" | "default" | "error";

export type PublicIngressExposure = {
  groupName: string;
  rule: FirewallRule;
};

function isPublicCidr(cidr: string): boolean {
  return (PUBLIC_CIDRS as readonly string[]).includes(cidr.trim());
}

export function findPublicIngressExposures(
  data: NetworkingTopologyData,
): PublicIngressExposure[] {
  const exposures: PublicIngressExposure[] = [];

  for (const group of data.securityGroups ?? []) {
    for (const rule of group.rules ?? []) {
      if (
        rule.direction === "ingress" &&
        rule.source !== undefined &&
        isPublicCidr(rule.source)
      ) {
        exposures.push({ groupName: group.name, rule });
      }
    }
  }

  return exposures;
}

const subnetTypeClasses: Record<"public" | "private" | "isolated", string> = {
  public: "bg-amber-50 text-amber-700",
  private: "bg-gray-100 text-gray-700",
  isolated: "bg-blue-50 text-blue-700",
};

function SubnetTypeBadge({ type }: { type: "public" | "private" | "isolated" }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${subnetTypeClasses[type]}`}
    >
      {type}
    </span>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

function NetworkingTopologySkeleton() {
  return (
    <div
      data-testid="networking-topology-skeleton"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-40" />
      </div>
      <Skeleton className="mt-2 h-4 w-32" />
      <div className="mt-2 flex gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-28" />
      </div>
      <Skeleton className="mt-4 h-3 w-20" />
      <div className="mt-1.5 space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton className="h-8 w-full" key={`subnet-${index}`} />
        ))}
      </div>
      <Skeleton className="mt-4 h-3 w-28" />
      <div className="mt-1.5 space-y-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton className="h-12 w-full" key={`group-${index}`} />
        ))}
      </div>
    </div>
  );
}

function NetworkingTopologyError({ errorMessage }: { errorMessage?: string }) {
  return (
    <div
      data-testid="networking-topology-error"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
    >
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Networking topology unavailable</p>
          <p className="mt-1 text-xs leading-relaxed">
            {errorMessage ??
              "The networking topology could not be loaded. It may have been updated or removed."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function NetworkingTopologyComponent({
  data,
  state = "default",
  errorMessage,
}: {
  data?: NetworkingTopologyData;
  state?: NetworkingTopologyState;
  errorMessage?: string;
}) {
  if (state === "error") {
    return <NetworkingTopologyError errorMessage={errorMessage} />;
  }

  if (state === "loading" || !data) {
    return <NetworkingTopologySkeleton />;
  }

  const exposures = findPublicIngressExposures(data);
  const hasExposure = exposures.length > 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">
          Networking Topology
        </span>
        {hasExposure ? (
          <span
            data-testid="public-exposure-badge"
            className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-900"
          >
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            Public Exposure Detected
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">
        {data.vpcName ?? "VPC"}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
          {data.vpcCidr}
        </span>
        {data.internetGateway ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            Internet Gateway (IGW)
          </span>
        ) : null}
        {data.natGateway ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            NAT Gateway
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Subnets ({data.subnets.length})
        </span>
        {data.subnets.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No subnets defined.</p>
        ) : (
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 font-semibold uppercase tracking-wider text-gray-400">
                  <th className="pb-2">Subnet</th>
                  <th className="pb-2">CIDR</th>
                  <th className="pb-2">AZ</th>
                  <th className="pb-2">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.subnets.map((subnet) => (
                  <tr key={subnet.name}>
                    <td className="py-2.5 font-medium text-gray-800">{subnet.name}</td>
                    <td className="py-2.5 font-mono text-gray-500">{subnet.cidr}</td>
                    <td className="py-2.5 text-gray-500">{subnet.zone ?? "—"}</td>
                    <td className="py-2.5">
                      <SubnetTypeBadge type={subnet.type} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.securityGroups && data.securityGroups.length > 0 ? (
        <div className="mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Security Groups
          </span>
          <div className="mt-1.5 space-y-2">
            {data.securityGroups.map((group) => {
              const ruleCount = group.rulesCount ?? group.rules?.length ?? 0;

              return (
                <div
                  className="rounded-lg border border-gray-100 p-2.5"
                  key={group.name}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-gray-800">
                      {group.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-gray-400">
                      {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
                    </span>
                  </div>
                  {group.rules && group.rules.length > 0 ? (
                    <div className="mt-2 divide-y divide-gray-100">
                      {group.rules.map((rule, index) => {
                        const exposed =
                          rule.direction === "ingress" &&
                          rule.source !== undefined &&
                          isPublicCidr(rule.source);

                        return (
                          <div
                            className={`flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs ${
                              exposed ? "rounded border border-red-200 bg-red-50" : ""
                            }`}
                            key={`${rule.direction}-${rule.protocol}-${rule.portRange}-${index}`}
                          >
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                rule.direction === "ingress"
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {rule.direction}
                            </span>
                            <span className="font-mono text-gray-800">
                              {rule.protocol}
                            </span>
                            <span className="font-mono text-gray-500">
                              {rule.portRange}
                            </span>
                            <span
                              className={`font-mono ${
                                exposed
                                  ? "font-semibold text-red-900"
                                  : "text-gray-500"
                              }`}
                            >
                              {rule.direction === "ingress"
                                ? `from ${rule.source ?? "any"}`
                                : `to ${rule.destination ?? "any"}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {hasExposure ? (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="leading-relaxed">
                {exposures.length} public ingress{" "}
                {exposures.length === 1 ? "rule allows" : "rules allow"} traffic
                from the public internet.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "networking_topology",
  version: "1.0",
  schema: networkingTopologySchema,
  component: NetworkingTopologyComponent,
});
