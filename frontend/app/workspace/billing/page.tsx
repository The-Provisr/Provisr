import { Button } from "@/components/ui/button";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
  StatCard,
interface BillingData {
  planName?: string;
  features?: string[];
  runsThisMonth?: number;
  activeWorkspaces?: number;
  totalResources?: number;
}

export default async function BillingUsagePage() {
  let billingData: BillingData | null = null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/v1/workspaces/current/billing`, { cache: 'no-store' });
    if (res.ok) {
      billingData = await res.json();
    }
  } catch (e) {
    // Orchestrator payload unavailable
  }

  return (
    <AppShell sidebar={<WorkspaceSidebar active="Billing & Usage" />}>
      <PageHeader
        description="Plan, usage, and billing controls for this workspace."
        title="Billing"
      />
      <PageBody>
        <div className="mx-auto max-w-[900px] space-y-4">
          <SectionCard title="Current plan">
            {billingData ? (
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-gray-900">{billingData.planName || "Unknown Plan"}</div>
                  <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                    {billingData.features?.map((f: string, i: number) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
                <Button variant="primary">Upgrade plan</Button>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                Billing plan details are currently unavailable.
              </div>
            )}
          </SectionCard>

          <section className="rounded-lg border border-blue-100 bg-blue-50 p-4" role="status">
            <div className="text-sm font-medium text-blue-900">
              Pricing and billing controls coming soon
            </div>
            <p className="mt-1 text-xs text-blue-700">
              We&apos;re building self-serve plan changes, invoices, and payment
              management. In the meantime, contact support for billing questions.
            </p>
          </section>

          <SectionCard title="Usage summary">
            {billingData ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Runs This Month" value={billingData.runsThisMonth?.toString() || "0"} />
                <StatCard label="Active Workspaces" value={billingData.activeWorkspaces?.toString() || "0"} />
                <StatCard label="Total Resources" value={billingData.totalResources?.toString() || "0"} />
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                Usage data is currently unavailable.
              </div>
            )}
          </SectionCard>

          <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white p-4 text-sm text-gray-600">
            <a
              className="font-medium text-slate-900 underline underline-offset-2"
              href="https://docs.provisr.dev/billing"
            >
              View billing documentation
            </a>
            <span>
              Questions? Contact{" "}
              <a className="font-medium text-slate-900 underline underline-offset-2" href="mailto:support@provisr.dev">
                support@provisr.dev
              </a>
            </span>
          </section>
        </div>
      </PageBody>
    </AppShell>
  );
}
