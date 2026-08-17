import { z } from "zod";
import { defaultRegistry } from "../registry";

export const containerCardSchema = z.object({
  image: z.string(),
  tag: z.string().optional(),
  port: z.number(),
  environmentVariables: z.record(z.string()).optional(),
  cpu: z.string().optional(),
  memory: z.string().optional(),
  healthCheckPath: z.string().optional(),
});

export type ContainerCardData = z.infer<typeof containerCardSchema>;

export function ContainerCardComponent({ data }: { data: ContainerCardData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600">
          Container Spec
        </span>
        <span className="rounded bg-cyan-50 px-2 py-0.5 font-mono text-xs font-medium text-cyan-800">
          Port {data.port}
        </span>
      </div>

      <div className="mt-2 font-mono text-sm font-semibold text-gray-900 break-all">
        {data.image}
        {data.tag ? <span className="text-gray-400">:{data.tag}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {data.cpu ? (
          <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">
            CPU: <strong>{data.cpu}</strong>
          </span>
        ) : null}
        {data.memory ? (
          <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">
            Memory: <strong>{data.memory}</strong>
          </span>
        ) : null}
        {data.healthCheckPath ? (
          <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-gray-700">
            Health: {data.healthCheckPath}
          </span>
        ) : null}
      </div>

      {data.environmentVariables && Object.keys(data.environmentVariables).length > 0 ? (
        <div className="mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Environment Variables ({Object.keys(data.environmentVariables).length})
          </span>
          <div className="mt-1.5 max-h-24 overflow-y-auto rounded-lg bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
            {Object.entries(data.environmentVariables).map(([k, v]) => (
              <div key={k} className="truncate">
                <span className="text-gray-500">{k}:</span> {v}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "container_card",
  version: "1.0",
  schema: containerCardSchema,
  component: ContainerCardComponent,
});
