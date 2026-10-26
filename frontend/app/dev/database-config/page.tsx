import { notFound } from "next/navigation";
import {
  DatabaseConfigComponent,
  type DatabaseConfigData,
} from "@/components/registry/components/database_config";
import { RegistryProvider } from "@/components/registry/RegistryProvider";
import { RegistryRenderer } from "@/components/registry/RegistryRenderer";

const safe: DatabaseConfigData = {
  engine: "postgres",
  version: "16.3",
  instanceClass: "db.t3.medium",
  allocatedStorageGb: 100,
  maxAllocatedStorageGb: 500,
  storageType: "gp3",
  multiAz: true,
  backupRetentionDays: 7,
  maintenanceWindow: "Sun 03:00-04:00 UTC",
  storageEncrypted: true,
  publiclyAccessible: false,
  deletionProtection: true,
};

const samples: Array<{ label: string; data: unknown }> = [
  { label: "Safe configuration", data: safe },
  { label: "Unencrypted storage", data: { ...safe, storageEncrypted: false } },
  { label: "Publicly accessible", data: { ...safe, publiclyAccessible: true } },
  { label: "Deletion protection off", data: { ...safe, deletionProtection: false } },
  { label: "Zero-day backup retention", data: { ...safe, backupRetentionDays: 0 } },
  {
    label: "All risky settings",
    data: {
      ...safe,
      engine: "mysql",
      version: "8.0",
      maxAllocatedStorageGb: undefined,
      maintenanceWindow: undefined,
      multiAz: false,
      storageEncrypted: false,
      publiclyAccessible: true,
      deletionProtection: false,
      backupRetentionDays: 0,
    },
  },
  { label: "Invalid payload (registry fallback)", data: { engine: "postgres" } },
];

function Sample({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</h2>
      {children}
    </section>
  );
}

// Dev-only preview of the FE-C08 database_config card with sample payloads.
export default function DatabaseConfigPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <RegistryProvider>
      <main className="mx-auto max-w-[850px] space-y-6 px-4 py-8">
        <h1 className="text-sm font-semibold text-gray-900">database_config card preview</h1>
        {samples.map((sample) => (
          <Sample key={sample.label} label={sample.label}>
            <RegistryRenderer
              payload={{
                type: "database_config",
                version: "1.0",
                requestId: "req_preview",
                data: sample.data,
              }}
            />
          </Sample>
        ))}
        <Sample label="Loading">
          <DatabaseConfigComponent state="loading" />
        </Sample>
        <Sample label="Missing payload (in-card fallback)">
          <DatabaseConfigComponent />
        </Sample>
      </main>
    </RegistryProvider>
  );
}
