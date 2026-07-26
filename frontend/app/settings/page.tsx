import { Button } from "@/components/ui/button";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/ui/provisr-app";

export default function UserSettingsPage() {
  return (
    <AppShell>
      <PageHeader
        actions={<Button variant="primary">Save preferences</Button>}
        description="Personal profile, notifications, security, and connected workspaces."
        title="User Settings"
      />
      <PageBody>
        <div className="mx-auto max-w-[900px] space-y-4">
          <SectionCard title="Profile">
            <div className="flex items-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-full border border-green-200 bg-green-100 text-lg font-bold text-green-700">
                S
              </div>
              <dl className="grid flex-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-gray-400">Name</dt>
                  <dd className="mt-1 font-medium text-gray-900">Sam Rivera</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Email</dt>
                  <dd className="mt-1 text-gray-700">sam@acme.dev</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Role</dt>
                  <dd className="mt-1">
                    <StatusBadge tone="blue">Auditor</StatusBadge>
                  </dd>
                </div>
              </dl>
            </div>
          </SectionCard>

          <SectionCard title="Notification preferences">
            <div className="grid gap-3 sm:grid-cols-2 text-sm text-gray-700">
              <div>Approval requests: Email and in-app</div>
              <div>Policy warnings: In-app</div>
              <div>Request updates: Email digest</div>
              <div>Drift alerts: In-app</div>
            </div>
          </SectionCard>

          <SectionCard title="Security settings">
            <div className="space-y-2 text-sm text-gray-700">
              <div>Clerk sign-in enabled</div>
              <div>Multi-factor authentication: Required by workspace</div>
              <div>Active sessions: 2</div>
            </div>
          </SectionCard>

          <SectionCard title="Connected workspaces">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="green">Acme Platform</StatusBadge>
              <StatusBadge tone="blue">Acme Sandbox</StatusBadge>
            </div>
          </SectionCard>
        </div>
      </PageBody>
    </AppShell>
  );
}
