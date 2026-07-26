import {
  AppShell,
  MiniBarChart,
  MiniLineChart,
  PageBody,
  PageHeader,
  ProviderPieChart,
  SectionCard,
  StatCard,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";

export default function WorkspaceInsightsPage() {
  return (
    <AppShell sidebar={<WorkspaceSidebar active="Insights" />}>
      <PageHeader
        description="Usage, cost, request, approval, and policy trends for Acme Platform."
        title="Workspace Insights"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <StatCard detail="Median this month" label="Approval turnaround" tone="green" value="42m" />
            <StatCard detail="Last 30 days" label="Policy warning count" tone="amber" value="38" />
            <StatCard detail="Across all members" label="Token usage" tone="blue" value="2.4M" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Token usage chart">
              <MiniBarChart
                data={[
                  { label: "Mon", value: 42 },
                  { label: "Tue", value: 64 },
                  { label: "Wed", value: 58 },
                  { label: "Thu", value: 80 },
                  { label: "Fri", value: 72 },
                  { label: "Sat", value: 36 },
                  { label: "Sun", value: 45 },
                ]}
              />
            </SectionCard>
            <SectionCard title="Infrastructure request volume chart">
              <MiniBarChart
                data={[
                  { label: "Mon", value: 8 },
                  { label: "Tue", value: 12 },
                  { label: "Wed", value: 9 },
                  { label: "Thu", value: 15 },
                  { label: "Fri", value: 11 },
                  { label: "Sat", value: 4 },
                  { label: "Sun", value: 6 },
                ]}
              />
            </SectionCard>
            <SectionCard title="Cloud cost trend chart">
              <MiniLineChart data={[72, 68, 64, 60, 55, 52, 48, 45]} />
            </SectionCard>
            <SectionCard title="Provider distribution pie chart">
              <ProviderPieChart
                segments={[
                  { label: "AWS", value: 58, color: "#0f172a" },
                  { label: "Azure", value: 25, color: "#2563eb" },
                  { label: "GCP", value: 17, color: "#16a34a" },
                ]}
              />
            </SectionCard>
          </div>
        </div>
      </PageBody>
    </AppShell>
  );
}
