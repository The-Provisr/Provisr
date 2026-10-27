import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { SessionBanner } from "@/components/auth/session-banner";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
} from "@/components/ui/provisr-app";

export const metadata: Metadata = {
  title: "Dashboard | Provisr",
};

export default async function DashboardPage() {
  const clerkEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
  if (clerkEnabled) {
    await auth.protect();
  }

  return (
    <AppShell>
      <PageHeader
        description="Your Provisr workspace at a glance."
        title="Dashboard"
      />
      <PageBody>
        <div className="mx-auto max-w-[900px] space-y-4">
          {clerkEnabled ? <SessionBanner /> : null}
          <SectionCard title="Workspace overview">
            <p className="text-sm text-gray-600">
              Summary widgets for policy posture, active resources, pending
              approvals, and recent activity land here.
            </p>
          </SectionCard>
          <ComingSoon
            description="Dashboards, charts, and cross-workspace insights are part of the analytics workstream."
            title="Workspace insights"
            week={10}
          />
        </div>
      </PageBody>
    </AppShell>
  );
}
