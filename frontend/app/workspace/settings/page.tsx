import { Button } from "@/components/ui/button";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";

export default function WorkspaceSettingsPage() {
  return (
    <AppShell sidebar={<WorkspaceSidebar active="Workspace Settings" />}>
      <PageHeader
        actions={<Button variant="primary">Save changes</Button>}
        description="Workspace-level defaults, approval behavior, notifications, and retention."
        title="Workspace Settings"
      />
      <PageBody>
        <div className="mx-auto max-w-[900px] space-y-4">
          <SectionCard title="Workspace profile">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-gray-400">Workspace name</dt>
                <dd className="mt-1 font-medium text-gray-900">Acme Platform</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Default environment</dt>
                <dd className="mt-1 font-medium text-gray-900">Production</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Default regions</dt>
                <dd className="mt-1 text-gray-700">us-east-1, eastus, us-central1</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Policy behavior</dt>
                <dd className="mt-1">
                  <StatusBadge tone="amber">Warn and require approval</StatusBadge>
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title="Approval requirements">
            <div className="space-y-2 text-sm text-gray-700">
              <div>Production changes require workspace approval.</div>
              <div>Cost increases over 20% require finance approval.</div>
              <div>Public endpoints require security review.</div>
            </div>
          </SectionCard>

          <SectionCard title="Notification and retention settings">
            <div className="grid gap-4 sm:grid-cols-2 text-sm text-gray-700">
              <div>Notify approvers in app and email.</div>
              <div>Retain audit events for 7 years.</div>
              <div>Send drift alerts daily.</div>
              <div>Archive inactive requests after 180 days.</div>
            </div>
          </SectionCard>

          <section className="rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="text-sm font-semibold text-red-900">Danger zone</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary">Archive workspace</Button>
              <Button variant="ghost">Delete workspace</Button>
            </div>
          </section>
        </div>
      </PageBody>
    </AppShell>
  );
}
