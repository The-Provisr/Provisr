import { z } from "zod";
import { AlertTriangleIcon, LockIcon, ShieldCheckIcon, UnlockIcon } from "@/components/ui/icons";
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

export type StorageCardState = "loading" | "default" | "error";

const UNENCRYPTED_VALUES = ["none", "disabled", "off", "unencrypted", "plaintext"];

export function isEncryptionEnabled(encryption?: string): boolean {
  if (!encryption) return false;
  return !UNENCRYPTED_VALUES.includes(encryption.trim().toLowerCase());
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

function StorageCardSkeleton() {
  return (
    <div
      data-testid="storage-card-skeleton"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
      <Skeleton className="mt-2 h-4 w-40" />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton className="h-14 w-full" key={`tile-${index}`} />
        ))}
      </div>
    </div>
  );
}

function StorageCardError({ errorMessage }: { errorMessage?: string }) {
  return (
    <div
      data-testid="storage-card-error"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
    >
      <p className="text-sm font-semibold">Storage resource unavailable</p>
      <p className="mt-1 text-xs leading-relaxed">
        {errorMessage ??
          "The storage resource could not be loaded. It may have been updated or removed."}
      </p>
    </div>
  );
}

export function StorageCardComponent({
  data,
  state = "default",
  errorMessage,
}: {
  data?: StorageCardData;
  state?: StorageCardState;
  errorMessage?: string;
}) {
  if (state === "error") {
    return <StorageCardError errorMessage={errorMessage} />;
  }

  if (state === "loading" || !data) {
    return <StorageCardSkeleton />;
  }

  const encryptionEnabled = isEncryptionEnabled(data.encryption);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">
          Object / Block Storage
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="encryption-badge"
            className={
              encryptionEnabled
                ? "flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-green-700"
                : "flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-900"
            }
          >
            {encryptionEnabled ? (
              <LockIcon className="size-3 shrink-0" />
            ) : (
              <UnlockIcon className="size-3 shrink-0" />
            )}
            {encryptionEnabled ? "Encrypted" : "Unencrypted"}
          </span>
          {data.publicAccessBlocked ? (
            <span
              data-testid="public-access-badge"
              className="flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-green-700"
            >
              <ShieldCheckIcon className="size-3 shrink-0" />
              Public Access Blocked
            </span>
          ) : (
            <span
              data-testid="public-access-badge"
              className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-900"
            >
              <AlertTriangleIcon className="size-3 shrink-0" />
              Public Access Allowed
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 font-mono text-sm font-semibold text-gray-900 break-all">
        {data.bucketName}
      </div>

      {data.encryption && encryptionEnabled ? (
        <p className="mt-1 text-xs text-gray-500">
          Encryption method:{" "}
          <span className="font-semibold text-gray-700">{data.encryption}</span>
        </p>
      ) : null}

      {!data.publicAccessBlocked ? (
        <div
          data-testid="public-access-alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs leading-relaxed">
            <span className="font-semibold">Public access is allowed.</span> This bucket or storage
            account is reachable from the public internet. Block public access before approving.
          </p>
        </div>
      ) : null}

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
