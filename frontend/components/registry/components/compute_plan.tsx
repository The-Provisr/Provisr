import { z } from "zod";
import { defaultRegistry } from "../registry";

import { computePlanSchema } from "@provisr/shared-contracts";
export { computePlanSchema } from "@provisr/shared-contracts";

export type ComputePlanData = z.infer<typeof computePlanSchema>;

export function ComputePlanComponent({ data }: { data: ComputePlanData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
          Compute Plan
        </span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
          {data.replicaCount} {data.replicaCount === 1 ? "Replica" : "Replicas"}
        </span>
      </div>

      <h3 className="mt-1 text-base font-semibold text-gray-900">{data.service}</h3>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {data.instanceType ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Size / Spec</span>
            <p className="font-semibold text-gray-800">{data.instanceType}</p>
          </div>
        ) : null}
        {data.architecture ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Arch</span>
            <p className="font-semibold text-gray-800 uppercase">{data.architecture}</p>
          </div>
        ) : null}
        {data.os ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">OS</span>
            <p className="font-semibold text-gray-800">{data.os}</p>
          </div>
        ) : null}
        {data.autoScaling ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Auto-Scaling</span>
            <p className="font-semibold text-gray-800">
              {data.autoScaling.min} - {data.autoScaling.max} units
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "compute_plan",
  version: "1.0",
  schema: computePlanSchema,
  component: ComputePlanComponent,
});
