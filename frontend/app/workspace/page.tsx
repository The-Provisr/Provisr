import { Button } from "@/components/ui/button";
import {
  CloudProviderLogo,
  type CloudProviderId,
} from "@/components/ui/cloud-provider-logo";
import {
  AppShell,
  DataTable,
  PageBody,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";

const auditRows = [
  ["Policy check completed", "policy-service", "req-prod-web-042", "Passed with warning"],
  ["Terraform plan generated", "provisioning", "req-prod-web-042", "Plan ready"],
  ["Approval requested", "approval-service", "req-prod-web-041", "Pending"],
];

const cloudProviders = [
  { id: "aws", label: "AWS" },
  { id: "azure", label: "Azure" },
  { id: "gcp", label: "GCP" },
] as const satisfies readonly { id: CloudProviderId; label: string }[];

export default function WorkspaceDashboardPage() {
  return (
    <AppShell sidebar={<WorkspaceSidebar active="Overview" />}>
      <PageHeader
        actions={<Button variant="primary">New Request</Button>}
        description="Admin overview for policy, providers, requests, and workspace activity."
        title="Workspace Dashboard"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          <SectionCard>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Acme Platform</div>
                <div className="mt-1 text-xs text-gray-500">Environment: Production</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {cloudProviders.map(({ id, label }) => (
                  <StatusBadge key={id} tone="blue">
                    <span className="flex items-center gap-2">
                      <CloudProviderLogo provider={id} size="sm" />
                      {label}
                    </span>
                  </StatusBadge>
                ))}
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-4">
            <StatCard detail="Across all environments" label="Active requests" value="18" />
            <StatCard detail="Production gates" label="Pending approvals" tone="amber" value="5" />
            <StatCard detail="Last 7 days" label="Policy warnings" tone="blue" value="12" />
            <StatCard detail="Synced this hour" label="Audit events" tone="green" value="248" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard eyebrow="Warnings" title="Recent policy warnings">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span>Public load balancer requires approval.</span>
                  <StatusBadge tone="amber">Requires approval</StatusBadge>
                </div>
                <div className="flex justify-between gap-4">
                  <span>RDS backup retention below workspace baseline.</span>
                  <StatusBadge tone="amber">Warning</StatusBadge>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Unencrypted bucket request blocked.</span>
                  <StatusBadge>Denied</StatusBadge>
                </div>
              </div>
            </SectionCard>

            <SectionCard eyebrow="Audit" title="Recent audit events">
              <DataTable
                columns={["Event", "Service", "Request", "Result"]}
                rows={auditRows.map((row) => [
                  row[0],
                  row[1],
                  <span className="font-medium text-gray-900" key={row[2]}>
                    {row[2]}
                  </span>,
                  row[3],
                ])}
              />
            </SectionCard>
          </div>
        </div>
      </PageBody>
    </AppShell>
  );
}
