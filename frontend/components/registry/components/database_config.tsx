import { z } from "zod";
import { defaultRegistry } from "../registry";

export const databaseConfigSchema = z.object({
  engine: z.string(),
  version: z.string().optional(),
  instanceClass: z.string().optional(),
  allocatedStorageGb: z.number().optional(),
  multiAz: z.boolean().default(false),
  storageType: z.string().optional(),
  backupRetentionDays: z.number().optional(),
});

export type DatabaseConfigData = z.infer<typeof databaseConfigSchema>;

export function DatabaseConfigComponent({ data }: { data: DatabaseConfigData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
          Database Configuration
        </span>
        {data.multiAz ? (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
            Multi-AZ Active
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            Single-AZ
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <h3 className="text-base font-semibold text-gray-900 capitalize">{data.engine}</h3>
        {data.version ? <span className="font-mono text-xs text-gray-500">v{data.version}</span> : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {data.instanceClass ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Instance Class</span>
            <p className="font-semibold text-gray-800">{data.instanceClass}</p>
          </div>
        ) : null}
        {data.allocatedStorageGb ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Storage</span>
            <p className="font-semibold text-gray-800">
              {data.allocatedStorageGb} GB {data.storageType ? `(${data.storageType})` : ""}
            </p>
          </div>
        ) : null}
        {data.backupRetentionDays !== undefined ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Backups</span>
            <p className="font-semibold text-gray-800">{data.backupRetentionDays} Days</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "database_config",
  version: "1.0",
  schema: databaseConfigSchema,
  component: DatabaseConfigComponent,
});
