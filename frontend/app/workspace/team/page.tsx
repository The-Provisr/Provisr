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

const members = [
  ["Maya Chen", "maya@acme.dev", "Workspace Admin", "Active", "5 minutes ago"],
  ["Owen Patel", "owen@acme.dev", "Engineer", "Active", "1 hour ago"],
  ["Lena Ortiz", "lena@acme.dev", "Approver", "Active", "Today"],
  ["Sam Rivera", "sam@acme.dev", "Auditor", "Invited", "Never"],
  ["Jules Kim", "jules@acme.dev", "Guided Requester", "Active", "Yesterday"],
];

export default function TeamPage() {
  return (
    <AppShell sidebar={<WorkspaceSidebar active="Team" />}>
      <PageHeader
        actions={<Button variant="primary">Invite member</Button>}
        description="Manage workspace members, roles, permissions, and approval ownership."
        title="Team"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          <SectionCard title="Members">
            <DataTable
              columns={["Name", "Email", "Role", "Status", "Last active", "Actions"]}
              rows={members.map(([name, email, role, status, lastActive]) => [
                <span className="font-medium text-gray-900" key={name}>
                  {name}
                </span>,
                email,
                role,
                <StatusBadge key={status} tone={status === "Active" ? "green" : "amber"}>
                  {status}
                </StatusBadge>,
                lastActive,
                <div className="flex flex-wrap gap-2" key={`${name}-actions`}>
                  <Button variant="secondary">Change role</Button>
                  <Button variant="secondary">View permissions</Button>
                  <Button variant="ghost">Remove member</Button>
                </div>,
              ])}
            />
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="Approvers">
              <div className="space-y-2 text-sm text-gray-700">
                <div>Lena Ortiz</div>
                <div>Maya Chen</div>
                <div>Platform Change Board</div>
              </div>
            </SectionCard>
            <SectionCard title="Approval rules">
              <div className="space-y-2 text-sm text-gray-700">
                <div>Production changes require one approver.</div>
                <div>Public endpoints require workspace admin review.</div>
              </div>
            </SectionCard>
            <SectionCard title="Pending approval queue">
              <div className="space-y-2 text-sm text-gray-700">
                <div>Deploy ECS web app</div>
                <div>Add Postgres read replica</div>
                <div>Set up staging cluster</div>
              </div>
            </SectionCard>
          </div>
        </div>
      </PageBody>
    </AppShell>
  );
}
