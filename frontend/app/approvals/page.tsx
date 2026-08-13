import { Button } from "@/components/ui/button";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/ui/provisr-app";

const approvalCards = [
  ["Deploy ECS web app", "Owen Patel", "Production", "Public ALB", "$482", "Public load balancer requires approval.", "+18 resources, 0 destroy"],
  ["Add Postgres read replica", "Maya Chen", "Production", "Production database change", "$146", "Database replication changes require approval.", "+2 resources, 0 destroy"],
];

export default function ApprovalsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Review gated infrastructure changes before controlled execution."
        title="Approvals"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
            Approval does not execute infrastructure automatically. Execution
            still requires the controlled Provisr flow.
          </div>

          <div className="flex flex-wrap gap-2">
            {["Pending approvals", "Approved", "Rejected", "Expired"].map((tab, index) => (
              <button
                className={
                  index === 0
                    ? "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                    : "rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                }
                key={tab}
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {approvalCards.map(([request, by, environment, risk, cost, warning, plan]) => (
              <SectionCard key={request} title={request}>
                <div className="space-y-4 text-sm">
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-gray-400">Requested by</dt>
                      <dd className="font-medium text-gray-900">{by}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">Environment</dt>
                      <dd>{environment}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">Risk reason</dt>
                      <dd>{risk}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">Cost estimate</dt>
                      <dd>{cost}</dd>
                    </div>
                  </dl>
                  <div>
                    <StatusBadge tone="amber">Policy warning</StatusBadge>
                    <p className="mt-2 text-gray-700">{warning}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-gray-700">
                    Terraform plan summary: {plan}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary">Approve</Button>
                    <Button variant="secondary">Reject</Button>
                    <Button variant="ghost">Request changes</Button>
                  </div>
                </div>
              </SectionCard>
            ))}
          </div>
        </div>
      </PageBody>
    </AppShell>
  );
}
