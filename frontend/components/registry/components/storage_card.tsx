import { z } from "zod";
import { defaultRegistry } from "../registry";

export const storageCardSchema = z.object({
  bucketName: z.string(),
  storageClass: z.string().optional(),
  versioning: z.boolean().default(false),
  encryption: z.string().optional(),
  publicAccessBlocked: z.boolean().default(true),
  lifecycleRulesCount: z.number().optional(),
});

export type StorageCardData = z.infer<typeof storageCardSchema>;

export function StorageCardComponent({ data }: { data: StorageCardData }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-teal-600">
          Object / Block Storage
        </span>
        {data.publicAccessBlocked ? (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
            Public Blocked
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
            Public Accessible
          </span>
        )}
      </div>

      <div className="mt-2 font-mono text-sm font-semibold text-gray-900 break-all">
        {data.bucketName}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {data.storageClass ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Class</span>
            <p className="font-semibold text-gray-800">{data.storageClass}</p>
          </div>
        ) : null}
        <div className="rounded-lg bg-gray-50 p-2">
          <span className="text-gray-400">Versioning</span>
          <p className="font-semibold text-gray-800">{data.versioning ? "Enabled" : "Disabled"}</p>
        </div>
        {data.encryption ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Encryption</span>
            <p className="font-semibold text-gray-800">{data.encryption}</p>
          </div>
        ) : null}
        {data.lifecycleRulesCount !== undefined ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <span className="text-gray-400">Lifecycle</span>
            <p className="font-semibold text-gray-800">{data.lifecycleRulesCount} Rules</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "storage_card",
  version: "1.0",
  schema: storageCardSchema,
  component: StorageCardComponent,
});
