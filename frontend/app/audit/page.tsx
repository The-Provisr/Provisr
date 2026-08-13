import { Button } from "@/components/ui/button";
import {
  AppShell,
  DataTable,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/ui/provisr-app";

const events = [
  ["User prompt received", "Owen Patel", "req-prod-web-042", "ws-acme-prod", "orchestrator", "2026-07-26 15:18", "Accepted"],
  ["Policy requirements loaded", "system", "req-prod-web-042", "ws-acme-prod", "policy-service", "2026-07-26 15:18", "Loaded"],
  ["Manifest created", "agent", "req-prod-web-042", "ws-acme-prod", "agent-service", "2026-07-26 15:19", "Created"],
  ["Terraform plan generated", "worker", "req-prod-web-042", "ws-acme-prod", "provisioning", "2026-07-26 15:21", "Ready"],
  ["Policy check completed", "system", "req-prod-web-042", "ws-acme-prod", "policy-service", "2026-07-26 15:22", "Warning"],
  ["Approval requested", "system", "req-prod-web-042", "ws-acme-prod", "approval-service", "2026-07-26 15:23", "Pending"],
  ["Approval granted", "Lena Ortiz", "req-stage-021", "ws-acme-prod", "approval-service", "2026-07-25 17:04", "Approved"],
  ["IaC execution started", "worker", "req-stage-021", "ws-acme-prod", "provisioning", "2026-07-25 17:10", "Started"],
  ["Cloud state synced", "reconciler", "req-stage-021", "ws-acme-prod", "reconciler", "2026-07-25 17:22", "Synced"],
];

export default function AuditLogPage() {
  return (
    <AppShell>
      <PageHeader
        description="Immutable workspace activity from chat, policy, approval, execution, and reconciliation."
        title="Audit Log"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-4">
          <SectionCard>
            <div className="flex flex-wrap gap-2">
              {["Actor", "Event type", "Request", "Date range"].map((filter) => (
                <Button key={filter} variant="secondary">
                  {filter}
                </Button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Workspace events">
            <DataTable
              columns={["Event type", "Actor", "Request ID", "Workspace ID", "Service", "Timestamp", "Result"]}
              rows={events.map(([event, actor, request, workspace, service, timestamp, result]) => [
                <span className="font-medium text-gray-900" key={event}>{event}</span>,
                actor,
                request,
                workspace,
                service,
                timestamp,
                <StatusBadge key={result} tone={result === "Warning" || result === "Pending" ? "amber" : "green"}>
                  {result}
                </StatusBadge>,
              ])}
            />
          </SectionCard>
        </div>
      </PageBody>
    </AppShell>
  );
}
