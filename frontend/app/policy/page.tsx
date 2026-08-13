import { Button } from "@/components/ui/button";
import {
  AppShell,
  DataTable,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";

const policies = [
  ["Require encrypted storage", "Security", "Active"],
  ["Production cost increase over 20%", "Cost", "Requires approval"],
  ["Public load balancer", "Environment", "Warning"],
  ["Terraform provider pinning", "Terraform / IaC", "Active"],
  ["Experimental regions", "Compliance", "Disabled"],
];

export default function PoliciesPage() {
  return (
    <AppShell sidebar={<WorkspaceSidebar active="Policies" />}>
      <PageHeader
        actions={<Button variant="secondary">View source</Button>}
        description="Manage workspace guardrails without exposing raw policy code by default."
        title="Policies"
      />
      <PageBody>
        <div className="mx-auto grid max-w-[1180px] gap-4 lg:grid-cols-[1.4fr_.8fr]">
          <SectionCard eyebrow="Active policy pack" title="Acme Guardrails">
            <div className="mb-4 flex flex-wrap gap-2">
              {["Security", "Cost", "Compliance", "Environment", "Terraform / IaC"].map((category) => (
                <StatusBadge key={category} tone="blue">
                  {category}
                </StatusBadge>
              ))}
            </div>
            <DataTable
              columns={["Rule", "Category", "Status"]}
              rows={policies.map(([rule, category, status]) => [
                <span className="font-medium text-gray-900" key={rule}>
                  {rule}
                </span>,
                category,
                <StatusBadge
                  key={status}
                  tone={status === "Active" ? "green" : status === "Disabled" ? "neutral" : "amber"}
                >
                  {status}
                </StatusBadge>,
              ])}
            />
          </SectionCard>

          <SectionCard eyebrow="Policy detail" title="Public load balancer">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-gray-400">Severity</dt>
                <dd className="mt-1 font-medium text-gray-900">Medium</dd>
              </div>
              <div>
                <dt className="text-gray-400">Decision type</dt>
                <dd className="mt-1 font-medium text-gray-900">Requires Approval</dd>
              </div>
              <div>
                <dt className="text-gray-400">Description</dt>
                <dd className="mt-1 leading-relaxed text-gray-700">
                  Internet-facing load balancers in production must be approved
                  by the workspace approver group before execution.
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Last updated</dt>
                <dd className="mt-1 text-gray-700">July 24, 2026</dd>
              </div>
            </dl>
          </SectionCard>
        </div>
      </PageBody>
    </AppShell>
  );
}
