import { notFound } from "next/navigation";
import { RegistryProvider } from "@/components/registry/RegistryProvider";
import { RegistryRenderer } from "@/components/registry/RegistryRenderer";
import { SecurityWarningComponent } from "@/components/registry/components/security_warning";

const samples = [
  { label: "Grouped findings", data: { findings: [
    { severity: "high", title: "Public S3 Bucket", description: "Anonymous visitors can access objects.", suggestedFix: "Block public access.", affectedResource: "assets" },
    { severity: "medium", title: "Unencrypted Storage", description: "Stored data has no encryption at rest.", suggestedFix: "Enable managed encryption." },
    { severity: "low", title: "Short log retention", description: "Logs expire after one day.", suggestedFix: "Increase retention to meet workspace policy." },
  ] } },
  { label: "Explicit clear result", data: { findings: [] } },
  { label: "Legacy payload", data: { title: "IAM Wildcard Permission", severity: "critical",
    description: "The role grants all actions.", mitigationSteps: ["Limit actions and resources."] } },
  { label: "Invalid payload", data: {} },
];

export default function SecurityWarningPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RegistryProvider><main className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-lg font-semibold text-gray-900">Security review panel</h1>
    {samples.map(sample => <section key={sample.label} className="space-y-2">
      <h2 className="text-sm text-gray-600">{sample.label}</h2>
      <RegistryRenderer payload={{ type: "security_warning", version: "1.0", requestId: "preview", data: sample.data }} />
    </section>)}
    <SecurityWarningComponent state="loading" />
    <SecurityWarningComponent state="error" />
  </main></RegistryProvider>;
}
