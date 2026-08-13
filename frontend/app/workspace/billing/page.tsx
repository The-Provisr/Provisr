import { Button } from "@/components/ui/button";
import {
  AppShell,
  DataTable,
  MiniBarChart,
  PageBody,
  PageHeader,
  ProviderPieChart,
  SectionCard,
  StatCard,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";

export default function BillingUsagePage() {
  return (
    <AppShell sidebar={<WorkspaceSidebar active="Billing & Usage" />}>
      <PageHeader
        actions={
          <>
            <Button variant="secondary">Manage payment method</Button>
            <Button variant="primary">Upgrade plan</Button>
          </>
        }
        description="Plan, billing, request runs, and usage across the workspace."
        title="Billing & Usage"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          <div className="grid gap-4 lg:grid-cols-4">
            <StatCard detail="Current plan" label="Plan" value="Business" />
            <StatCard detail="This billing cycle" label="Monthly usage" tone="blue" value="68%" />
            <StatCard detail="2.4M of 5M included" label="Token usage" tone="green" value="2.4M" />
            <StatCard detail="3 active workspaces" label="Request runs" tone="amber" value="124" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Token usage over time">
              <MiniBarChart data={[24, 32, 42, 36, 58, 64, 72].map((value, index) => ({ label: `D${index + 1}`, value }))} />
            </SectionCard>
            <SectionCard title="Request runs by day">
              <MiniBarChart data={[8, 12, 9, 15, 13, 5, 7].map((value, index) => ({ label: `D${index + 1}`, value }))} />
            </SectionCard>
            <SectionCard title="Usage by workspace member">
              <DataTable
                columns={["Member", "Tokens", "Request runs"]}
                rows={[
                  ["Maya Chen", "620K", "32"],
                  ["Owen Patel", "540K", "28"],
                  ["Jules Kim", "310K", "18"],
                ]}
              />
            </SectionCard>
            <SectionCard title="Usage by provider">
              <ProviderPieChart
                segments={[
                  { label: "AWS", value: 64, color: "#0f172a" },
                  { label: "Azure", value: 22, color: "#2563eb" },
                  { label: "GCP", value: 14, color: "#16a34a" },
                ]}
              />
            </SectionCard>
          </div>

          <SectionCard title="Invoice history">
            <DataTable
              columns={["Invoice", "Date", "Amount", "Status", "Action"]}
              rows={[
                ["INV-2026-07", "July 1, 2026", "$1,240", "Paid", <Button key="july" variant="secondary">Download invoice</Button>],
                ["INV-2026-06", "June 1, 2026", "$1,180", "Paid", <Button key="june" variant="secondary">Download invoice</Button>],
              ]}
            />
          </SectionCard>
        </div>
      </PageBody>
    </AppShell>
  );
}
