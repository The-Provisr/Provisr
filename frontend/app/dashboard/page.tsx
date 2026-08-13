import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { SessionBanner } from "@/components/auth/session-banner";

export const metadata: Metadata = {
  title: "Dashboard | Provisr",
};

export default async function DashboardPage() {
  await auth.protect();

  return (
    <main>
      <SessionBanner />
      <h1>Dashboard</h1>
      <p>Your Provisr workspace.</p>
    </main>
  );
}
