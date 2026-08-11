import { Button } from "@/components/ui/button";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
  StatCard,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";

export default function BillingUsagePage() {
  return (
    <AppShell sidebar={<WorkspaceSidebar active="Billing & Usage" />}>
      <PageHeader
        description="Plan, usage, and billing controls for this workspace."
        title="Billing"
      />
      <PageBody>
        <div className="mx-auto max-w-[900px] space-y-4">
          <SectionCard title="Current plan">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-gray-900">Team Plan</div>
                <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                  <li>Unlimited workspace members</li>
                  <li>Up to 10 active cloud accounts</li>
                  <li>Standard policy engine and approvals</li>
                  <li>30-day audit log retention</li>
                  <li>Email support</li>
                </ul>
              </div>
              <Button variant="primary">Upgrade plan</Button>
            </div>
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
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Runs This Month" value="124" />
              <StatCard label="Active Workspaces" value="3" />
              <StatCard label="Total Resources" value="482" />
            </div>
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
